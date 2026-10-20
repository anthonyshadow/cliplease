import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PART_CONCURRENCY, PART_URL_BATCH } from "./limits";
import { type OriginalMeta, uploadOriginal } from "./upload-original";

const VIDEO_ID = "11111111-1111-4111-8111-111111111111";
const META: OriginalMeta = { durationMs: 14000, width: 720, height: 1280 };
const SIZE = 100;
const PART_SIZE = 4;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const multipart = (partCount = 25) => ({
  mode: "multipart",
  key: "k",
  uploadId: "u",
  partSize: PART_SIZE,
  partCount,
  doneParts: [],
});

/** A part PUT: partial then full progress, then its answer, each a timer apart. Abort answers at once, as browsers do. */
class FakeXhr {
  static all: FakeXhr[] = [];
  static inFlight = 0;
  static maxInFlight = 0;
  static failUrl: string | null = null;

  method = "";
  url = "";
  status = 0;
  headers: [string, string][] = [];
  body: Blob | null = null;
  aborted = false;
  answered = false;
  upload: { onprogress: ((event: { loaded: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers.push([name, value]);
  }

  send(body: Blob) {
    this.body = body;
    FakeXhr.all.push(this);
    FakeXhr.inFlight++;
    FakeXhr.maxInFlight = Math.max(FakeXhr.maxInFlight, FakeXhr.inFlight);
    setTimeout(() => {
      if (this.aborted) return;
      this.upload.onprogress?.({ loaded: Math.floor(body.size / 2) });
      setTimeout(() => {
        if (this.aborted) return;
        this.upload.onprogress?.({ loaded: body.size });
        this.status = this.url === FakeXhr.failUrl ? 500 : 200;
        this.answered = true;
        FakeXhr.inFlight--;
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

type Call = { route: string; body: unknown; sends: number };
let calls: Call[];
let startAnswer: () => Response;

const bodiesOf = (route: string) =>
  calls.filter((c) => c.route === route).map((c) => c.body);

beforeEach(() => {
  calls = [];
  startAnswer = () => json(multipart());
  FakeXhr.all = [];
  FakeXhr.inFlight = 0;
  FakeXhr.maxInFlight = 0;
  FakeXhr.failUrl = null;
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      const route = String(input).replace("/api/uploads/", "");
      const body: unknown = JSON.parse(String(init?.body));
      calls.push({ route, body, sends: FakeXhr.all.length });
      if (route === "start") return startAnswer();
      if (route === "parts") {
        const { partNumbers } = body as { partNumbers: number[] };
        return json({
          urls: Object.fromEntries(
            partNumbers.map((n) => [n, `https://example.test/part/${n}`]),
          ),
        });
      }
      return json({ ok: true });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const file = () =>
  new File([new Uint8Array(SIZE)], "a.mp4", { type: "video/mp4" });

function upload(
  extra: {
    meta?: Promise<OriginalMeta | null>;
    signal?: AbortSignal;
    onProgress?: (sent: number, total: number) => void;
    onPartsDone?: () => void;
  } = {},
) {
  return uploadOriginal({
    videoId: VIDEO_ID,
    file: file(),
    contentType: "video/mp4",
    meta: Promise.resolve(META),
    ...extra,
  });
}

describe("uploadOriginal (02 §5.9, 07 D80)", () => {
  it("starts, sends every part and completes with the hints", async () => {
    const progress: [number, number][] = [];
    const order: string[] = [];
    const result = await upload({
      onProgress: (sent, total) => progress.push([sent, total]),
      onPartsDone: () => order.push("partsDone"),
    });
    order.push(...calls.map((c) => c.route));

    expect(result).toEqual({ ok: true });
    expect(bodiesOf("start")).toEqual([
      {
        kind: "original",
        videoId: VIDEO_ID,
        fileName: "a.mp4",
        size: SIZE,
        contentType: "video/mp4",
      },
    ]);

    const range = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => from + i);
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
      range(1, 25)
        .map((n) => `https://example.test/part/${n}`)
        .sort(),
    );
    for (const xhr of FakeXhr.all) {
      expect(xhr.method).toBe("PUT");
      expect(xhr.headers).toEqual([]);
      expect(xhr.body).toBeInstanceOf(Blob);
      expect(xhr.body?.size).toBe(PART_SIZE);
      expect(xhr.body?.type).toBe("");
    }

    expect(progress.length).toBeGreaterThan(0);
    for (const [index, [sent, total]] of progress.entries()) {
      expect(total).toBe(SIZE);
      expect(sent).toBeLessThanOrEqual(SIZE);
      expect(sent).toBeGreaterThanOrEqual(progress[index - 1]?.[0] ?? 0);
    }
    expect(progress.at(-1)).toEqual([SIZE, SIZE]);

    expect(order.filter((step) => step === "partsDone")).toHaveLength(1);
    expect(order.indexOf("partsDone")).toBeLessThan(order.indexOf("complete"));
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

  it("fails with network when a part answers 500, aborting the parts in flight", async () => {
    FakeXhr.failUrl = "https://example.test/part/2";
    expect(await upload()).toEqual({ ok: false, code: "network" });
    const failed = FakeXhr.all.find((x) => x.url === FakeXhr.failUrl);
    expect(failed?.status).toBe(500);
    const unanswered = FakeXhr.all.filter((x) => !x.answered);
    expect(unanswered.length).toBeGreaterThan(0);
    for (const xhr of unanswered) expect(xhr.aborted).toBe(true);
    expect(FakeXhr.inFlight).toBe(0);
    expect(bodiesOf("complete")).toEqual([]);
  });

  it("is canceled when the caller aborts mid-flight, and never completes", async () => {
    const controller = new AbortController();
    const result = await upload({
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    expect(result).toEqual({ ok: false, code: "canceled" });
    expect(FakeXhr.all.some((x) => x.aborted)).toBe(true);
    expect(FakeXhr.inFlight).toBe(0);
    expect(bodiesOf("complete")).toEqual([]);
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
    startAnswer = () => json(multipart(24));
    expect(await upload()).toEqual({ ok: false, code: "internal" });
    expect(bodiesOf("parts")).toEqual([]);
    expect(FakeXhr.all).toEqual([]);
  });
});
