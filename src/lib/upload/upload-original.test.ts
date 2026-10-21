import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeNetwork,
  fakeXhr,
  memoryStorage,
} from "../../../tests/helpers/upload-fakes";
import { PART_CONCURRENCY, PART_MAX_ATTEMPTS, PART_URL_BATCH } from "./limits";
import { type ResumeHint, resumeHintKey } from "./resume";
import { RETRY_DELAYS_MS } from "./retry";
import {
  abortOriginalUpload,
  browserHints,
  type OriginalMeta,
  type UploadOriginalInput,
  uploadOriginal,
} from "./upload-original";

const VIDEO_ID = "11111111-1111-4111-8111-111111111111";
const META: OriginalMeta = { durationMs: 14000, width: 720, height: 1280 };
const SIZE = 100;
const PART_SIZE = 4;
const LAST_MODIFIED = 1_760_000_000_000;
const HINT_KEY = resumeHintKey(VIDEO_ID);
const HINT = {
  uploadId: "u",
  name: "a.mp4",
  size: SIZE,
  lastModified: LAST_MODIFIED,
};
const START_BODY = {
  kind: "original",
  videoId: VIDEO_ID,
  fileName: "a.mp4",
  size: SIZE,
  contentType: "video/mp4",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const dropped = (): Response => {
  throw new TypeError("Failed to fetch");
};

/** Answers in turn; the last one repeats. */
function inTurn(...answers: (() => Response)[]) {
  let n = 0;
  return () => {
    const answer = answers[Math.min(n, answers.length - 1)];
    n += 1;
    if (!answer) throw new Error("no answer");
    return answer();
  };
}

const multipart = (
  extra: { partCount?: number; uploadId?: string; doneParts?: number[] } = {},
) => ({
  mode: "multipart",
  key: "k",
  uploadId: "u",
  partSize: PART_SIZE,
  partCount: 25,
  doneParts: [],
  ...extra,
});

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

const partUrl = (n: number) => `https://example.test/part/${n}`;
const partOf = (url: string) => Number(/\/part\/(\d+)/.exec(url)?.[1]);

type Call = {
  route: string;
  body: unknown;
  init: RequestInit | undefined;
  sends: number;
  at: number;
};
let calls: Call[];
let events: string[];
let progress: [number, number][];
let startAnswer: () => Response;
/** A parts call's answer, or null for fresh URLs. */
let partsAnswer: (partNumbers: number[]) => Response | null;
let completeAnswer: () => Response;
let abortAnswer: () => Response;
let network: ReturnType<typeof fakeNetwork>;
let hints: ReturnType<typeof memoryStorage>;
let xhrs: ReturnType<typeof fakeXhr>;

const bodiesOf = (route: string) =>
  calls.filter((c) => c.route === route).map((c) => c.body);
/** A part's PUTs in order, to each URL it was signed with. */
const sendsOf = (part: number) =>
  xhrs.all.filter((x) => partOf(x.url) === part);
/** The statuses reported so far, from the event log. */
const statuses = () =>
  events
    .filter((event) => event.startsWith("status:"))
    .map((event) => event.slice("status:".length));
const savedHint = (): unknown => {
  const raw = hints.items.get(HINT_KEY);
  return raw === undefined ? undefined : JSON.parse(raw);
};
const saveHint = (hint: ResumeHint) =>
  hints.items.set(HINT_KEY, JSON.stringify(hint));

beforeEach(() => {
  calls = [];
  events = [];
  progress = [];
  startAnswer = () => json(multipart());
  partsAnswer = () => null;
  completeAnswer = () => json({ ok: true });
  abortAnswer = () => new Response(null, { status: 204 });
  network = fakeNetwork();
  hints = memoryStorage();
  // A hint write is logged in `events`, in order with the routes.
  hints.setItem.mockImplementation((key, value) => {
    events.push("hint");
    hints.items.set(key, value);
  });
  xhrs = fakeXhr();
  const signed = new Map<number, number>();
  vi.stubGlobal("XMLHttpRequest", xhrs.XMLHttpRequest);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      const route = String(input).replace("/api/uploads/", "");
      const body: unknown = JSON.parse(String(init?.body));
      calls.push({
        route,
        body,
        init,
        sends: xhrs.all.length,
        at: Date.now(),
      });
      events.push(route);
      if (route === "start") return startAnswer();
      if (route === "parts") {
        // A part signed again gets a new URL.
        const { partNumbers } = body as { partNumbers: number[] };
        const answer = partsAnswer(partNumbers);
        if (answer) return answer;
        const urls = partNumbers.map((n) => {
          const count = (signed.get(n) ?? 0) + 1;
          signed.set(n, count);
          return [n, count === 1 ? partUrl(n) : `${partUrl(n)}?sig=${count}`];
        });
        return json({ urls: Object.fromEntries(urls) });
      }
      if (route === "complete") return completeAnswer();
      return abortAnswer();
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const fakeTimers = () =>
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });

const file = () =>
  new File([new Uint8Array(SIZE)], "a.mp4", {
    type: "video/mp4",
    lastModified: LAST_MODIFIED,
  });

function upload(extra: Partial<UploadOriginalInput> = {}) {
  return uploadOriginal({
    videoId: VIDEO_ID,
    file: file(),
    contentType: "video/mp4",
    meta: Promise.resolve(META),
    hints,
    network,
    random: () => 0,
    onStatus: (status) => events.push(`status:${status}`),
    onProgress: (sent, total) => progress.push([sent, total]),
    ...extra,
  });
}

/** Every report is of the whole file, never going back or past it. */
function expectSteadyProgress() {
  expect(progress.length).toBeGreaterThan(0);
  for (const [index, [sent, total]] of progress.entries()) {
    expect(total).toBe(SIZE);
    expect(sent).toBeLessThanOrEqual(SIZE);
    expect(sent).toBeGreaterThanOrEqual(progress[index - 1]?.[0] ?? 0);
  }
  expect(progress.at(-1)).toEqual([SIZE, SIZE]);
}

describe("uploadOriginal (02 §5.9, 07 D80)", () => {
  it("starts, sends every part and completes with the hints", async () => {
    const result = await upload();

    expect(result).toEqual({ ok: true });
    expect(bodiesOf("start")).toEqual([START_BODY]);
    expect(bodiesOf("start")[0]).not.toHaveProperty("resume");

    expect(bodiesOf("parts")).toEqual([
      { videoId: VIDEO_ID, uploadId: "u", partNumbers: range(1, 20) },
      { videoId: VIDEO_ID, uploadId: "u", partNumbers: range(21, 25) },
    ]);
    // The second batch is asked for only once the first batch's parts are mostly sent.
    const partCalls = calls.filter((c) => c.route === "parts");
    expect(partCalls[0]?.sends).toBe(0);
    expect(partCalls[1]?.sends).toBeGreaterThanOrEqual(
      PART_URL_BATCH - PART_CONCURRENCY + 1,
    );

    expect(xhrs.all).toHaveLength(25);
    expect(xhrs.maxInFlight).toBe(PART_CONCURRENCY);
    expect(xhrs.all.map((x) => x.url).sort()).toEqual(
      range(1, 25).map(partUrl).sort(),
    );
    for (const xhr of xhrs.all) {
      expect(xhr.method).toBe("PUT");
      expect(xhr.headers).toEqual([]);
      expect(xhr.body).toBeInstanceOf(Blob);
      expect(xhr.body?.size).toBe(PART_SIZE);
      expect(xhr.body?.type).toBe("");
    }

    expectSteadyProgress();
    expect(statuses()).toEqual(["uploading", "checking"]);
    expect(events.indexOf("status:checking")).toBeLessThan(
      events.indexOf("complete"),
    );
    // Named, so it finishes this upload only (owner decision).
    expect(bodiesOf("complete")).toEqual([
      { kind: "original", videoId: VIDEO_ID, uploadId: "u", meta: META },
    ]);
  });

  it("completes without meta when the hints couldn't be read", async () => {
    expect(await upload({ meta: Promise.resolve(null) })).toEqual({
      ok: true,
    });
    expect(bodiesOf("complete")).toEqual([
      { kind: "original", videoId: VIDEO_ID, uploadId: "u" },
    ]);
  });

  it("leaves resume out of start unless it resumes", async () => {
    await upload({ resume: false });
    expect(bodiesOf("start")).toEqual([START_BODY]);
    expect(bodiesOf("start")[0]).not.toHaveProperty("resume");
  });

  it("is canceled when the caller aborts mid-flight, keeping the hint, and never completes", async () => {
    const controller = new AbortController();
    const result = await upload({
      signal: controller.signal,
      onProgress: (sent) => {
        if (sent > 0) controller.abort();
      },
    });
    expect(result).toEqual({ ok: false, code: "canceled" });
    expect(xhrs.all.some((x) => x.aborted)).toBe(true);
    expect(xhrs.inFlight).toBe(0);
    expect(bodiesOf("complete")).toEqual([]);
    expect(statuses()).not.toContain("checking");
    expect(savedHint()).toEqual(HINT);
  });

  it.each([
    [409, { code: "original_locked" }, "original_locked"],
    [401, { error: { code: "unauthorized" } }, "unauthorized"],
  ])("maps a start answering %i to its code", async (status, body, code) => {
    startAnswer = () => json(body, status);
    expect(await upload()).toEqual({ ok: false, code });
    expect(bodiesOf("parts")).toEqual([]);
    expect(xhrs.all).toEqual([]);
  });

  it("is network when fetch rejects, never sending a fresh start again", async () => {
    const rejecting = vi.fn(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    vi.stubGlobal("fetch", rejecting);
    expect(await upload()).toEqual({ ok: false, code: "network" });
    expect(rejecting).toHaveBeenCalledTimes(1);
  });

  it("is internal when start's partCount disagrees with the plan", async () => {
    startAnswer = () => json(multipart({ partCount: 24 }));
    expect(await upload()).toEqual({ ok: false, code: "internal" });
    expect(bodiesOf("parts")).toEqual([]);
    expect(xhrs.all).toEqual([]);
  });
});

describe("retries (07 D80, owner answer Q-45 a)", () => {
  it(`pauses after ${PART_MAX_ATTEMPTS} retries of a part that keeps failing, aborting the parts in flight`, async () => {
    fakeTimers();
    xhrs.answers = (xhr) => (partOf(xhr.url) === 2 ? 500 : "hang");
    const pending = upload();
    await vi.runAllTimersAsync();

    expect(await pending).toEqual({ ok: false, code: "paused" });
    const sends = sendsOf(2);
    expect(sends).toHaveLength(1 + PART_MAX_ATTEMPTS);
    const waits = sends
      .slice(1)
      .map((xhr, i) => xhr.sentAt - (sends[i]?.answeredAt ?? 0));
    expect(waits).toEqual([...RETRY_DELAYS_MS]);
    // A 500 gets no re-sign.
    for (const xhr of sends) expect(xhr.url).toBe(partUrl(2));
    expect(bodiesOf("parts")).toEqual([
      { videoId: VIDEO_ID, uploadId: "u", partNumbers: range(1, 20) },
    ]);

    const others = xhrs.all.filter((x) => partOf(x.url) !== 2);
    expect(others).toHaveLength(PART_CONCURRENCY - 1);
    for (const xhr of others) expect(xhr.aborted).toBe(true);
    expect(xhrs.inFlight).toBe(0);
    expect(bodiesOf("complete")).toEqual([]);
    expect(statuses()).toEqual(["uploading", "retrying"]);
    // Choosing the same file resumes it.
    expect(savedHint()).toEqual(HINT);
  });

  it.each([
    ["a dropped connection", "error"],
    ["a 403", 403],
  ] as const)(
    "re-signs a part after %s and sends it again after the first wait",
    async (_, failure) => {
      fakeTimers();
      // Fails part 2's first PUT only: its retry goes to a re-signed URL.
      xhrs.answers = (xhr, send) =>
        xhr.url === partUrl(2) && send === 1 ? failure : 200;
      const pending = upload();
      await vi.runAllTimersAsync();

      expect(await pending).toEqual({ ok: true });
      const [first, second] = sendsOf(2);
      expect(first?.url).toBe(partUrl(2));
      expect(second?.url).toBe(`${partUrl(2)}?sig=2`);
      const wait = (second?.sentAt ?? 0) - (first?.answeredAt ?? 0);
      expect(wait).toBeGreaterThanOrEqual(1000);
      expect(wait).toBeLessThan(1250);
      expect(bodiesOf("parts")).toContainEqual({
        videoId: VIDEO_ID,
        uploadId: "u",
        partNumbers: [2],
      });
      expect(xhrs.all).toHaveLength(26);
      expect(statuses()).toEqual([
        "uploading",
        "retrying",
        "uploading",
        "checking",
      ]);
      expect(bodiesOf("complete")).toHaveLength(1);
    },
  );

  it("sends complete again after a dropped connection", async () => {
    fakeTimers();
    completeAnswer = inTurn(dropped, () => json({ ok: true }));
    const pending = upload();
    await vi.runAllTimersAsync();

    expect(await pending).toEqual({ ok: true });
    const [first, second] = calls.filter((c) => c.route === "complete");
    expect((second?.at ?? 0) - (first?.at ?? 0)).toBe(1000);
    expect(savedHint()).toBeUndefined();
  });

  it(`gives up on complete after ${PART_MAX_ATTEMPTS} retries, keeping the hint`, async () => {
    fakeTimers();
    completeAnswer = dropped;
    const pending = upload();
    await vi.runAllTimersAsync();

    expect(await pending).toEqual({ ok: false, code: "network" });
    expect(bodiesOf("complete")).toHaveLength(1 + PART_MAX_ATTEMPTS);
    expect(savedHint()).toEqual(HINT);
  });

  it.each<[string, () => void]>([
    [
      "a part PUT",
      () => {
        xhrs.answers = (xhr) => (partOf(xhr.url) === 2 ? 404 : 200);
      },
    ],
    [
      "the part URLs",
      () => {
        partsAnswer = () => json({ code: "not_found" }, 404);
      },
    ],
    [
      "a part's re-sign",
      () => {
        xhrs.answers = (xhr) => (partOf(xhr.url) === 2 ? 403 : 200);
        partsAnswer = (partNumbers) =>
          partNumbers.length === 1 ? json({ code: "not_found" }, 404) : null;
      },
    ],
  ])(
    "ends as stale_upload with no complete when %s answers 404: the upload isn't open any more",
    async (_, setup) => {
      setup();
      expect(await upload()).toEqual({ ok: false, code: "stale_upload" });
      expect(sendsOf(2).length).toBeLessThanOrEqual(1);
      expect(statuses()).not.toContain("checking");
      expect(bodiesOf("complete")).toEqual([]);
      expect(savedHint()).toBeUndefined();
    },
  );

  it("ends as upload_expired with no complete when the part URLs answer 410", async () => {
    partsAnswer = () => json({ code: "upload_expired" }, 410);
    expect(await upload()).toEqual({ ok: false, code: "upload_expired" });
    expect(xhrs.all).toEqual([]);
    expect(bodiesOf("complete")).toEqual([]);
    expect(savedHint()).toBeUndefined();
  });

  it("ends as upload_expired, asking no second time, when a part's re-sign answers 410", async () => {
    fakeTimers();
    xhrs.answers = (xhr) => (partOf(xhr.url) === 2 ? 403 : 200);
    partsAnswer = (partNumbers) =>
      partNumbers.length === 1 ? json({ code: "upload_expired" }, 410) : null;
    const pending = upload();
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ ok: false, code: "upload_expired" });
    expect(bodiesOf("parts")).toEqual([
      { videoId: VIDEO_ID, uploadId: "u", partNumbers: range(1, 20) },
      { videoId: VIDEO_ID, uploadId: "u", partNumbers: [2] },
    ]);
    expect(sendsOf(2)).toHaveLength(1);
    expect(bodiesOf("complete")).toEqual([]);
  });
});

describe("offline (07 D80)", () => {
  it("starts no part while offline and goes on by itself once back online", async () => {
    fakeTimers();
    let partsWhenOffline = 0;
    const pending = upload({
      onProgress: (sent) => {
        if (sent > 0 && partsWhenOffline === 0) {
          partsWhenOffline = xhrs.all.length;
          network.set(false);
        }
      },
    });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(partsWhenOffline).toBe(PART_CONCURRENCY);
    expect(xhrs.all).toHaveLength(PART_CONCURRENCY);
    expect(statuses()).toEqual(["uploading", "paused"]);
    // Nothing polls while it waits.
    expect(vi.getTimerCount()).toBe(0);

    network.set(true);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ ok: true });
    expect(statuses()).toEqual([
      "uploading",
      "paused",
      "uploading",
      "checking",
    ]);
    expect(xhrs.all).toHaveLength(25);
  });
});

describe("resume (07 D80)", () => {
  it("starts with resume and sends only the missing parts, progress counting the stored bytes", async () => {
    const done = [...range(1, 10), 15];
    const missing = range(1, 25).filter((n) => !done.includes(n));
    startAnswer = () => json(multipart({ doneParts: done }));
    const onStarted = vi.fn();

    const result = await upload({
      resume: true,
      expectedUploadId: "u",
      onStarted,
    });

    expect(result).toEqual({ ok: true });
    expect(bodiesOf("start")).toEqual([{ ...START_BODY, resume: true }]);
    expect(onStarted).toHaveBeenCalledWith("u");
    expect(bodiesOf("parts")).toEqual([
      { videoId: VIDEO_ID, uploadId: "u", partNumbers: missing },
    ]);
    expect(xhrs.all.map((x) => partOf(x.url)).sort((a, b) => a - b)).toEqual(
      missing,
    );
    expect(progress[0]).toEqual([done.length * PART_SIZE, SIZE]);
    expectSteadyProgress();
  });

  it("sends nothing and forgets the hint when start answers another upload than this device's", async () => {
    saveHint({ ...HINT, uploadId: "old" });
    const onStarted = vi.fn();

    const result = await upload({
      resume: true,
      expectedUploadId: "old",
      onStarted,
    });

    expect(result).toEqual({ ok: false, code: "stale_upload" });
    expect(bodiesOf("parts")).toEqual([]);
    expect(xhrs.all).toEqual([]);
    expect(bodiesOf("complete")).toEqual([]);
    expect(onStarted).not.toHaveBeenCalled();
    expect(savedHint()).toBeUndefined();
  });

  it("makes one resume pass when complete finds a part missing, then completes", async () => {
    startAnswer = inTurn(
      () => json(multipart()),
      () => json(multipart({ doneParts: range(1, 25).filter((n) => n !== 7) })),
    );
    completeAnswer = inTurn(
      () => json({ code: "parts_incomplete" }, 409),
      () => json({ ok: true }),
    );

    expect(await upload()).toEqual({ ok: true });
    const [first, second] = bodiesOf("start");
    expect(first).not.toHaveProperty("resume");
    expect(second).toEqual({ ...START_BODY, resume: true });
    expect(sendsOf(7)).toHaveLength(2);
    expect(xhrs.all).toHaveLength(26);
    expect(bodiesOf("complete")).toEqual([
      { kind: "original", videoId: VIDEO_ID, uploadId: "u", meta: META },
      { kind: "original", videoId: VIDEO_ID, uploadId: "u", meta: META },
    ]);
    expect(savedHint()).toBeUndefined();
  });

  it("starts the repair pass from the bytes the server holds, reported before it says uploading again", async () => {
    startAnswer = inTurn(
      () => json(multipart()),
      () => json(multipart({ doneParts: range(1, 25).filter((n) => n !== 7) })),
    );
    completeAnswer = inTurn(
      () => json({ code: "parts_incomplete" }, 409),
      () => json({ ok: true }),
    );
    const seen: [string, number | undefined][] = [];

    expect(
      await upload({
        onStatus: (status) => seen.push([status, progress.at(-1)?.[0]]),
      }),
    ).toEqual({ ok: true });
    expect(seen).toEqual([
      ["uploading", 0],
      ["checking", SIZE],
      ["uploading", 24 * PART_SIZE],
      ["checking", SIZE],
    ]);
  });

  it("makes no second resume pass", async () => {
    startAnswer = inTurn(
      () => json(multipart()),
      () => json(multipart({ doneParts: range(1, 25) })),
    );
    completeAnswer = () => json({ code: "parts_incomplete" }, 409);

    expect(await upload()).toEqual({ ok: false, code: "parts_incomplete" });
    expect(bodiesOf("start")).toHaveLength(2);
    expect(bodiesOf("complete")).toHaveLength(2);
  });
});

describe("a resume's start (07 D80, 04 §9.26 Paused)", () => {
  const resume = { resume: true, expectedUploadId: "u" } as const;

  it("is sent again after a dropped connection, and the upload goes on", async () => {
    fakeTimers();
    startAnswer = inTurn(dropped, () => json(multipart({ doneParts: [1] })));
    const pending = upload(resume);
    await vi.runAllTimersAsync();

    expect(await pending).toEqual({ ok: true });
    const [first, second] = calls.filter((c) => c.route === "start");
    expect((second?.at ?? 0) - (first?.at ?? 0)).toBe(RETRY_DELAYS_MS[0]);
    expect(xhrs.all).toHaveLength(24);
  });

  it(`pauses after ${PART_MAX_ATTEMPTS} retries with no answer, keeping the hint`, async () => {
    fakeTimers();
    saveHint(HINT);
    startAnswer = dropped;
    const pending = upload(resume);
    await vi.runAllTimersAsync();

    expect(await pending).toEqual({ ok: false, code: "paused" });
    expect(bodiesOf("start")).toHaveLength(1 + PART_MAX_ATTEMPTS);
    expect(bodiesOf("parts")).toEqual([]);
    expect(savedHint()).toEqual(HINT);
  });

  it("shows paused while offline and goes on once back online", async () => {
    network.set(false);
    // Offline, the browser's fetch fails at once; the start then waits for the connection.
    startAnswer = inTurn(dropped, () => json(multipart()));
    const pending = upload(resume);
    await vi.waitFor(() => expect(bodiesOf("start")).toHaveLength(1));
    expect(statuses()).toEqual(["paused"]);

    network.set(true);
    expect(await pending).toEqual({ ok: true });
    expect(statuses().slice(0, 2)).toEqual(["paused", "uploading"]);
    expect(bodiesOf("start")).toHaveLength(2);
  });

  it("is canceled by a Cancel during the wait, with no start after it", async () => {
    fakeTimers();
    startAnswer = dropped;
    const controller = new AbortController();
    const pending = upload({ ...resume, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();

    expect(await pending).toEqual({ ok: false, code: "canceled" });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(bodiesOf("start")).toHaveLength(1);
  });
});

describe("complete first (Try again after complete's answer was lost, 07 D80)", () => {
  const again = {
    resume: true,
    expectedUploadId: "u",
    completeFirst: true,
  } as const;

  it("asks complete, naming the upload, and sends no start and no part when it's assembled", async () => {
    saveHint(HINT);
    expect(await upload(again)).toEqual({ ok: true });
    expect(calls.map((c) => c.route)).toEqual(["complete"]);
    expect(bodiesOf("complete")).toEqual([
      { kind: "original", videoId: VIDEO_ID, uploadId: "u", meta: META },
    ]);
    expect(statuses()).toEqual(["checking"]);
    expect(savedHint()).toBeUndefined();
  });

  it("resumes when a part is missing: only that part, then complete", async () => {
    startAnswer = () =>
      json(multipart({ doneParts: range(1, 25).filter((n) => n !== 7) }));
    completeAnswer = inTurn(
      () => json({ code: "parts_incomplete" }, 409),
      () => json({ ok: true }),
    );

    expect(await upload(again)).toEqual({ ok: true });
    expect(calls.map((c) => c.route)).toEqual([
      "complete",
      "start",
      "parts",
      "complete",
    ]);
    expect(bodiesOf("start")).toEqual([{ ...START_BODY, resume: true }]);
    expect(xhrs.all.map((x) => partOf(x.url))).toEqual([7]);
    expect(statuses()).toEqual(["checking", "uploading", "checking"]);
  });

  it("makes no second resume pass after it", async () => {
    startAnswer = () => json(multipart({ doneParts: range(1, 25) }));
    completeAnswer = () => json({ code: "parts_incomplete" }, 409);
    expect(await upload(again)).toEqual({
      ok: false,
      code: "parts_incomplete",
    });
    expect(bodiesOf("start")).toHaveLength(1);
    expect(bodiesOf("complete")).toHaveLength(2);
  });

  it("answers upload_expired as it is, forgetting the hint", async () => {
    saveHint(HINT);
    completeAnswer = () => json({ code: "upload_expired" }, 410);
    expect(await upload(again)).toEqual({
      ok: false,
      code: "upload_expired",
    });
    expect(bodiesOf("start")).toEqual([]);
    expect(savedHint()).toBeUndefined();
  });
});

describe("the resume hint (07 D80, D103)", () => {
  it("holds exactly { uploadId, name, size, lastModified } from start until done", async () => {
    let during: unknown;
    const result = await upload({
      onProgress: () => {
        during ??= savedHint();
      },
    });

    expect(result).toEqual({ ok: true });
    expect(events.slice(0, 2)).toEqual(["start", "hint"]);
    expect(hints.setItem).toHaveBeenCalledTimes(1);
    expect(hints.setItem.mock.calls[0]?.[0]).toBe(HINT_KEY);
    expect(during).toStrictEqual(HINT);
    expect(savedHint()).toBeUndefined();
  });

  it("is never written when Cancel comes while start answers, though the opened upload is told", async () => {
    const controller = new AbortController();
    const onStarted = vi.fn();
    startAnswer = () => {
      controller.abort();
      return json(multipart());
    };

    expect(await upload({ signal: controller.signal, onStarted })).toEqual({
      ok: false,
      code: "canceled",
    });
    expect(hints.setItem).not.toHaveBeenCalled();
    expect(savedHint()).toBeUndefined();
    // The caller's abort names it (owner answer Q-50).
    expect(onStarted).toHaveBeenCalledWith("u");
    expect(bodiesOf("parts")).toEqual([]);
    expect(xhrs.all).toEqual([]);
  });

  it("is left alone by a run whose start never answered: that run wrote none", async () => {
    saveHint(HINT);
    startAnswer = () => json({ code: "original_locked" }, 409);
    expect(await upload()).toEqual({ ok: false, code: "original_locked" });
    expect(savedHint()).toEqual(HINT);
  });

  it("keeps a newer upload's hint when this run ends with nothing to resume (owner answer Q-50)", async () => {
    const newer = { ...HINT, uploadId: "newer" };
    saveHint(newer);
    expect(await upload({ resume: true, expectedUploadId: "x" })).toEqual({
      ok: false,
      code: "stale_upload",
    });
    expect(savedHint()).toEqual(newer);
  });

  it("is cleared when start answers upload_expired", async () => {
    saveHint(HINT);
    startAnswer = () => json({ code: "upload_expired" }, 410);
    expect(await upload({ resume: true, expectedUploadId: "u" })).toEqual({
      ok: false,
      code: "upload_expired",
    });
    expect(bodiesOf("parts")).toEqual([]);
    expect(savedHint()).toBeUndefined();
  });

  it.each(["upload_expired", "size_mismatch", "bad_signature_bytes"] as const)(
    "is cleared when complete answers %s",
    async (code) => {
      completeAnswer = () => json({ code }, 422);
      expect(await upload()).toEqual({ ok: false, code });
      expect(savedHint()).toBeUndefined();
    },
  );

  it("works without a store", async () => {
    expect(await upload({ hints: null })).toEqual({ ok: true });
  });

  it("is in no store where the browser has none", () => {
    expect(browserHints()).toBeNull();
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    expect(browserHints()).toBeNull();
  });
});

describe("abortOriginalUpload (04 §9.26 Cancel)", () => {
  it("asks the server to end that upload, even while the page closes (owner answer Q-50)", async () => {
    expect(await abortOriginalUpload(VIDEO_ID, "u")).toBe(true);
    const [call] = calls;
    expect(call?.route).toBe("abort");
    expect(call?.body).toEqual({ videoId: VIDEO_ID, uploadId: "u" });
    expect(call?.init).toMatchObject({
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
    });
  });

  it("with no upload known, ends whatever the video has open", async () => {
    expect(await abortOriginalUpload(VIDEO_ID, null)).toBe(true);
    expect(calls[0]?.body).toEqual({ videoId: VIDEO_ID });
  });

  it("is false when the server doesn't confirm it", async () => {
    abortAnswer = () => json({ code: "internal" }, 500);
    expect(await abortOriginalUpload(VIDEO_ID, "u")).toBe(false);
  });

  it("is false, never throwing, when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(abortOriginalUpload(VIDEO_ID, "u")).resolves.toBe(false);
  });
});
