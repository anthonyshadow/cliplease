import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeNetwork,
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

/** How a part's nth send answers: a status, a dropped connection, or nothing until it is aborted. */
type Answer = number | "error" | "hang";

/** A part PUT: partial then full progress, then its answer, each a timer apart. Abort answers at once, as browsers do. */
class FakeXhr {
  static all: FakeXhr[] = [];
  static inFlight = 0;
  static maxInFlight = 0;
  static answer: (part: number, send: number) => Answer = () => 200;

  static sendsOf(part: number) {
    return FakeXhr.all.filter((x) => x.part === part);
  }

  method = "";
  url = "";
  part = 0;
  status = 0;
  headers: [string, string][] = [];
  body: Blob | null = null;
  aborted = false;
  answered = false;
  sentAt = 0;
  answeredAt = 0;
  upload: { onprogress: ((event: { loaded: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
    this.part = partOf(url);
  }

  setRequestHeader(name: string, value: string) {
    this.headers.push([name, value]);
  }

  send(body: Blob) {
    this.body = body;
    this.sentAt = Date.now();
    FakeXhr.all.push(this);
    FakeXhr.inFlight++;
    FakeXhr.maxInFlight = Math.max(FakeXhr.maxInFlight, FakeXhr.inFlight);
    const answer = FakeXhr.answer(this.part, FakeXhr.sendsOf(this.part).length);
    if (answer === "hang") return;
    setTimeout(() => {
      if (this.aborted) return;
      this.upload.onprogress?.({ loaded: Math.floor(body.size / 2) });
      setTimeout(() => {
        if (this.aborted) return;
        this.answered = true;
        this.answeredAt = Date.now();
        FakeXhr.inFlight--;
        if (answer === "error") {
          this.onerror?.();
          return;
        }
        this.upload.onprogress?.({ loaded: body.size });
        this.status = answer;
        this.onload?.();
      }, 0);
    }, 0);
  }

  abort() {
    if (this.aborted || this.answered) return;
    this.aborted = true;
    FakeXhr.inFlight--;
    this.onabort?.();
  }
}

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
let completeAnswer: () => Response;
let abortAnswer: () => Response;
let network: ReturnType<typeof fakeNetwork>;
let hints: ReturnType<typeof memoryStorage>;

const bodiesOf = (route: string) =>
  calls.filter((c) => c.route === route).map((c) => c.body);
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
  completeAnswer = () => json({ ok: true });
  abortAnswer = () => new Response(null, { status: 204 });
  network = fakeNetwork();
  hints = memoryStorage();
  // A hint write is logged in `events`, in order with the routes.
  hints.setItem.mockImplementation((key, value) => {
    events.push("hint");
    hints.items.set(key, value);
  });
  FakeXhr.all = [];
  FakeXhr.inFlight = 0;
  FakeXhr.maxInFlight = 0;
  FakeXhr.answer = () => 200;
  const signed = new Map<number, number>();
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
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
        sends: FakeXhr.all.length,
        at: Date.now(),
      });
      events.push(route);
      if (route === "start") return startAnswer();
      if (route === "parts") {
        // A part signed again gets a new URL.
        const { partNumbers } = body as { partNumbers: number[] };
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

    expect(FakeXhr.all).toHaveLength(25);
    expect(FakeXhr.maxInFlight).toBe(PART_CONCURRENCY);
    expect(FakeXhr.all.map((x) => x.url).sort()).toEqual(
      range(1, 25).map(partUrl).sort(),
    );
    for (const xhr of FakeXhr.all) {
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
    expect(bodiesOf("complete")).toEqual([
      { kind: "original", videoId: VIDEO_ID, meta: META },
    ]);
  });

  it("completes without meta when the hints couldn't be read", async () => {
    expect(await upload({ meta: Promise.resolve(null) })).toEqual({
      ok: true,
    });
    expect(bodiesOf("complete")).toEqual([
      { kind: "original", videoId: VIDEO_ID },
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
    expect(FakeXhr.all.some((x) => x.aborted)).toBe(true);
    expect(FakeXhr.inFlight).toBe(0);
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
    expect(FakeXhr.all).toEqual([]);
  });

  it("is network when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    expect(await upload()).toEqual({ ok: false, code: "network" });
  });

  it("is internal when start's partCount disagrees with the plan", async () => {
    startAnswer = () => json(multipart({ partCount: 24 }));
    expect(await upload()).toEqual({ ok: false, code: "internal" });
    expect(bodiesOf("parts")).toEqual([]);
    expect(FakeXhr.all).toEqual([]);
  });
});

describe("retries (07 D80, owner answer Q-45 a)", () => {
  it(`pauses after ${PART_MAX_ATTEMPTS} retries of a part that keeps failing, aborting the parts in flight`, async () => {
    fakeTimers();
    FakeXhr.answer = (part) => (part === 2 ? 500 : "hang");
    const pending = upload();
    await vi.runAllTimersAsync();

    expect(await pending).toEqual({ ok: false, code: "paused" });
    const sends = FakeXhr.sendsOf(2);
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

    const others = FakeXhr.all.filter((x) => x.part !== 2);
    expect(others).toHaveLength(PART_CONCURRENCY - 1);
    for (const xhr of others) expect(xhr.aborted).toBe(true);
    expect(FakeXhr.inFlight).toBe(0);
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
      FakeXhr.answer = (part, send) =>
        part === 2 && send === 1 ? failure : 200;
      const pending = upload();
      await vi.runAllTimersAsync();

      expect(await pending).toEqual({ ok: true });
      const [first, second] = FakeXhr.sendsOf(2);
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
      expect(FakeXhr.all).toHaveLength(26);
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

  it.each([
    ["ok", () => json({ ok: true }), { ok: true }],
    [
      "upload_expired",
      () => json({ code: "upload_expired" }, 410),
      { ok: false, code: "upload_expired" },
    ],
  ] as const)(
    "goes straight to complete when a part answers 404, which answers %s",
    async (_, answer, result) => {
      FakeXhr.answer = (part) => (part === 2 ? 404 : 200);
      completeAnswer = answer;
      expect(await upload()).toEqual(result);
      expect(FakeXhr.sendsOf(2)).toHaveLength(1);
      expect(bodiesOf("parts")).toHaveLength(1);
      expect(statuses()).toEqual(["uploading", "checking"]);
      expect(bodiesOf("complete")).toHaveLength(1);
      expect(savedHint()).toBeUndefined();
    },
  );
});

describe("offline (07 D80)", () => {
  it("starts no part while offline and goes on by itself once back online", async () => {
    fakeTimers();
    let partsWhenOffline = 0;
    const pending = upload({
      onProgress: (sent) => {
        if (sent > 0 && partsWhenOffline === 0) {
          partsWhenOffline = FakeXhr.all.length;
          network.set(false);
        }
      },
    });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(partsWhenOffline).toBe(PART_CONCURRENCY);
    expect(FakeXhr.all).toHaveLength(PART_CONCURRENCY);
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
    expect(FakeXhr.all).toHaveLength(25);
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
    expect(FakeXhr.all.map((x) => x.part).sort((a, b) => a - b)).toEqual(
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
    expect(FakeXhr.all).toEqual([]);
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
    expect(FakeXhr.sendsOf(7)).toHaveLength(2);
    expect(FakeXhr.all).toHaveLength(26);
    expect(bodiesOf("complete")).toHaveLength(2);
    expect(savedHint()).toBeUndefined();
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
    expect(FakeXhr.all).toEqual([]);
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
