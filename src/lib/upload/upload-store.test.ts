import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { encodeImageToJpeg } from "../media/encode-image";
import type {
  readVideoMetadata,
  VideoMeta,
} from "../media/read-video-metadata";
import type { UploadResult } from "./http";
import type { uploadFile } from "./upload-file";
import type { UploadOriginalInput, uploadOriginal } from "./upload-original";
import type * as Store from "./upload-store";

const m = vi.hoisted(() => ({
  readVideoMetadata: vi.fn<typeof readVideoMetadata>(),
  encodeImageToJpeg: vi.fn<typeof encodeImageToJpeg>(),
  uploadFile: vi.fn<typeof uploadFile>(),
  uploadOriginal: vi.fn<typeof uploadOriginal>(),
}));

vi.mock("../media/read-video-metadata", () => ({
  readVideoMetadata: m.readVideoMetadata,
}));
vi.mock("../media/encode-image", () => ({
  encodeImageToJpeg: m.encodeImageToJpeg,
}));
vi.mock("./upload-file", () => ({ uploadFile: m.uploadFile }));
vi.mock("./upload-original", () => ({ uploadOriginal: m.uploadOriginal }));
// useUploads is a hook: read the snapshot straight from getSnapshot, outside React.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useSyncExternalStore: <T>(_subscribe: unknown, getSnapshot: () => T) =>
    getSnapshot(),
}));

const VIDEO_ID = "11111111-1111-4111-8111-111111111111";

let store: typeof Store;
let reads: PromiseWithResolvers<VideoMeta>[];
let originals: {
  input: UploadOriginalInput;
  answer: PromiseWithResolvers<UploadResult>;
}[];
let covers: PromiseWithResolvers<UploadResult>[];
let addListener: ReturnType<typeof vi.fn>;
let removeListener: ReturnType<typeof vi.fn>;

const frame = new Blob(["frame"], { type: "image/jpeg" });
const picked = new Blob(["picked"], { type: "image/jpeg" });
const video = (name = "a.mp4") =>
  new File([new Uint8Array(100)], name, { type: "video/mp4" });
const image = () => new File(["png"], "cover.png", { type: "image/png" });
const meta = (poster: Blob | null): VideoMeta => ({
  durationMs: 14000,
  width: 720,
  height: 1280,
  poster,
});

/** Lets every queued promise callback run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

const state = () => store.useUploads();
const original = () => state().originals[VIDEO_ID];
const cover = () => state().covers[VIDEO_ID];

function start(captureCover: boolean, file = video()) {
  store.startOriginalUpload({
    videoId: VIDEO_ID,
    title: "First snow",
    file,
    contentType: "video/mp4",
    captureCover,
  });
}

/** The options of the nth readVideoMetadata call. */
const readOptions = (n: number) => m.readVideoMetadata.mock.calls[n]?.[2];

/** The latest uploadOriginal call. */
function latest() {
  const call = originals.at(-1);
  if (!call) throw new Error("uploadOriginal was not called");
  return call;
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  reads = [];
  originals = [];
  covers = [];
  m.readVideoMetadata.mockImplementation(() => {
    const read = Promise.withResolvers<VideoMeta>();
    reads.push(read);
    return read.promise;
  });
  m.uploadOriginal.mockImplementation((input) => {
    const answer = Promise.withResolvers<UploadResult>();
    originals.push({ input, answer });
    return answer.promise;
  });
  m.uploadFile.mockImplementation(() => {
    const answer = Promise.withResolvers<UploadResult>();
    covers.push(answer);
    return answer.promise;
  });
  m.encodeImageToJpeg.mockResolvedValue({ ok: true, blob: picked });
  addListener = vi.fn();
  removeListener = vi.fn();
  vi.stubGlobal("window", {
    addEventListener: addListener,
    removeEventListener: removeListener,
  });
  store = await import("./upload-store");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the cover (owner answer Q-41 a)", () => {
  it("reads no frame for the cover when the creator chose it", async () => {
    const file = video();
    start(false, file);
    expect(m.readVideoMetadata).toHaveBeenCalledWith(file, 15_000, {
      poster: false,
      onHints: expect.any(Function),
    });
    reads[0]?.resolve(meta(frame));
    await flush();
    expect(m.uploadFile).not.toHaveBeenCalled();
    expect(cover()).toBeUndefined();
  });

  it("uploads a frame when there is no chosen cover", async () => {
    start(true);
    expect(readOptions(0)?.poster).toBe(true);
    expect(cover()).toMatchObject({
      phase: "capturing",
      origin: "frame_capture",
    });
    reads[0]?.resolve(meta(frame));
    await flush();
    expect(m.uploadFile).toHaveBeenCalledTimes(1);
    expect(m.uploadFile.mock.calls[0]?.[0]).toMatchObject({
      videoId: VIDEO_ID,
      kind: "poster",
      body: frame,
      posterOrigin: "frame_capture",
    });
    covers[0]?.resolve({ ok: true });
    await flush();
    expect(cover()).toMatchObject({ phase: "done", origin: "frame_capture" });
  });

  it("drops a frame read after the creator picked an image", async () => {
    start(true);
    await store.pickCover(VIDEO_ID, image());
    reads[0]?.resolve(meta(frame));
    await flush();
    expect(m.uploadFile).toHaveBeenCalledTimes(1);
    for (const [input] of m.uploadFile.mock.calls) {
      expect(input.posterOrigin).toBe("creator_image");
      expect(input.body).toBe(picked);
    }
    expect(cover()?.origin).toBe("creator_image");
  });

  it("uploads a picked image after the frame already on its way", async () => {
    start(true);
    reads[0]?.resolve(meta(frame));
    await flush();
    expect(m.uploadFile).toHaveBeenCalledTimes(1);

    await store.pickCover(VIDEO_ID, image());
    await flush();
    expect(cover()).toMatchObject({
      phase: "uploading",
      origin: "creator_image",
    });
    // The pick waits for the frame's upload to answer.
    expect(m.uploadFile).toHaveBeenCalledTimes(1);
    expect(m.uploadFile.mock.calls[0]?.[0].signal?.aborted).toBe(true);

    covers[0]?.resolve({ ok: false, code: "canceled" });
    await flush();
    expect(
      m.uploadFile.mock.calls.map(([input]) => input.posterOrigin),
    ).toEqual(["frame_capture", "creator_image"]);
    expect(cover()?.origin).toBe("creator_image");

    covers[1]?.resolve({ ok: true });
    await flush();
    expect(cover()).toMatchObject({ phase: "done", origin: "creator_image" });
  });

  it("keeps the frame on its way when a picked image can't be used", async () => {
    start(true);
    reads[0]?.resolve(meta(frame));
    await flush();
    const preview = cover()?.preview;
    m.encodeImageToJpeg.mockResolvedValueOnce({ ok: false, code: "bad_type" });

    await store.pickCover(VIDEO_ID, image());
    expect(cover()).toMatchObject({
      phase: "uploading",
      origin: "frame_capture",
      error: "bad_type",
      preview,
    });
    expect(m.uploadFile).toHaveBeenCalledTimes(1);

    covers[0]?.resolve({ ok: true });
    await flush();
    expect(cover()).toMatchObject({ phase: "done", origin: "frame_capture" });
  });

  it("aborts the older file's frame on its way when a new file replaces it", async () => {
    const second = new Blob(["second"], { type: "image/jpeg" });
    start(true, video("first.mp4"));
    reads[0]?.resolve(meta(frame));
    await flush();
    const signal = m.uploadFile.mock.calls[0]?.[0].signal;

    start(true, video("second.mp4"));
    expect(signal?.aborted).toBe(true);
    expect(cover()?.phase).toBe("capturing");
    // The older frame's late answer doesn't touch the new capture.
    covers[0]?.resolve({ ok: true });
    await flush();
    expect(cover()?.phase).toBe("capturing");

    reads[1]?.resolve(meta(second));
    await flush();
    expect(m.uploadFile.mock.calls[1]?.[0].body).toBe(second);
    covers[1]?.resolve({ ok: true });
    await flush();
    expect(cover()).toMatchObject({ phase: "done", origin: "frame_capture" });
  });

  it("retries the last cover after a failed upload", async () => {
    start(true);
    reads[0]?.resolve(meta(frame));
    await flush();
    covers[0]?.resolve({ ok: false, code: "network" });
    await flush();
    expect(cover()).toMatchObject({ phase: "error", error: "upload_failed" });

    store.retryCover(VIDEO_ID);
    await flush();
    expect(cover()).toMatchObject({ phase: "uploading", error: null });
    expect(m.uploadFile).toHaveBeenCalledTimes(2);
    expect(m.uploadFile.mock.calls[1]?.[0]).toMatchObject({
      body: frame,
      posterOrigin: "frame_capture",
    });
  });
});

describe("the original (owner answer Q-42)", () => {
  it("shows an error and retries with the same file", async () => {
    const file = video();
    start(false, file);
    latest().answer.resolve({ ok: false, code: "network" });
    await flush();
    expect(original()).toMatchObject({ phase: "error", error: "network" });

    expect(store.retryOriginalUpload(VIDEO_ID, true)).toBe(true);
    expect(m.uploadOriginal).toHaveBeenCalledTimes(2);
    expect(latest().input.file).toBe(file);
    expect(original()).toMatchObject({
      phase: "uploading",
      error: null,
      title: "First snow",
    });
  });

  it("takes no second frame on retry once the file's frame is stored", async () => {
    start(true);
    reads[0]?.resolve(meta(frame));
    await flush();
    covers[0]?.resolve({ ok: true });
    latest().answer.resolve({ ok: false, code: "network" });
    await flush();
    expect(cover()?.phase).toBe("done");

    expect(store.retryOriginalUpload(VIDEO_ID, true)).toBe(true);
    expect(readOptions(1)?.poster).toBe(false);
    reads[1]?.resolve(meta(frame));
    await flush();
    expect(m.uploadFile).toHaveBeenCalledTimes(1);
    expect(cover()).toMatchObject({ phase: "done", origin: "frame_capture" });
  });

  it("can't retry a video it never started", () => {
    expect(store.retryOriginalUpload(VIDEO_ID, false)).toBe(false);
    expect(m.uploadOriginal).not.toHaveBeenCalled();
  });

  it("cancels: aborts the parts and drops a cover still being read", async () => {
    start(true);
    const { input, answer } = latest();
    store.cancelOriginalUpload(VIDEO_ID);
    // The File step returns to rest: the floating card has nothing to show.
    expect(original()).toMatchObject({ phase: "canceled", seen: true });
    expect(input.signal?.aborted).toBe(true);
    expect(cover()).toBeUndefined();

    answer.resolve({ ok: false, code: "canceled" });
    reads[0]?.resolve(meta(frame));
    await flush();
    expect(original()?.phase).toBe("canceled");
    expect(cover()).toBeUndefined();
    expect(m.uploadFile).not.toHaveBeenCalled();
  });

  it("cancels: a frame from the cancelled file on its way is dropped too", async () => {
    start(true);
    reads[0]?.resolve(meta(frame));
    await flush();
    expect(cover()).toMatchObject({
      phase: "uploading",
      origin: "frame_capture",
    });
    const signal = m.uploadFile.mock.calls[0]?.[0].signal;

    store.cancelOriginalUpload(VIDEO_ID);
    expect(signal?.aborted).toBe(true);
    expect(cover()).toBeUndefined();
    covers[0]?.resolve({ ok: true });
    await flush();
    expect(cover()).toBeUndefined();
  });

  it("cancels: a chosen image on its way stays", async () => {
    start(false);
    await store.pickCover(VIDEO_ID, image());
    await flush();
    expect(cover()).toMatchObject({
      phase: "uploading",
      origin: "creator_image",
    });
    const signal = m.uploadFile.mock.calls[0]?.[0].signal;

    store.cancelOriginalUpload(VIDEO_ID);
    expect(signal?.aborted).toBe(false);
    covers[0]?.resolve({ ok: true });
    await flush();
    expect(cover()).toMatchObject({ phase: "done", origin: "creator_image" });
  });

  it("can't cancel once every part is in", () => {
    start(false);
    latest().input.onPartsDone?.();
    store.cancelOriginalUpload(VIDEO_ID);
    expect(original()).toMatchObject({ phase: "checking", sent: 100 });
    expect(latest().input.signal?.aborted).toBe(false);
  });

  it("completes as soon as the hints are known, without waiting for the frame", async () => {
    start(true);
    const hints = { durationMs: 14000, width: 720, height: 1280 };
    readOptions(0)?.onHints?.(hints);
    await expect(latest().input.meta).resolves.toEqual(hints);
    expect(cover()?.phase).toBe("capturing");

    latest().input.onPartsDone?.();
    latest().answer.resolve({ ok: true });
    await flush();
    expect(original()).toMatchObject({ phase: "done", hints });
    expect(cover()?.phase).toBe("capturing");
  });

  it("ends done with the hints read from the file", async () => {
    start(false);
    reads[0]?.resolve(meta(frame));
    latest().input.onPartsDone?.();
    latest().answer.resolve({ ok: true });
    await flush();
    expect(original()).toMatchObject({
      phase: "done",
      hints: { durationMs: 14000, width: 720, height: 1280 },
    });
  });

  it.each([
    ["done", { ok: true }],
    ["error", { ok: false, code: "network" }],
  ] as const)(
    "guards leaving the tab while it runs, until %s",
    async (phase, result) => {
      start(false);
      reads[0]?.resolve(meta(null));
      expect(addListener).toHaveBeenCalledTimes(1);
      expect(addListener.mock.calls[0]?.[0]).toBe("beforeunload");
      const warn = addListener.mock.calls[0]?.[1];

      latest().input.onPartsDone?.();
      expect(original()?.phase).toBe("checking");
      expect(addListener).toHaveBeenCalledTimes(1);
      expect(removeListener).not.toHaveBeenCalled();

      latest().answer.resolve(result);
      await flush();
      expect(original()?.phase).toBe(phase);
      expect(removeListener).toHaveBeenCalledTimes(1);
      expect(removeListener).toHaveBeenCalledWith("beforeunload", warn);
    },
  );

  it.each([
    ["uploading", true],
    ["checking", true],
    ["done", false],
    ["error", false],
    ["canceled", false],
  ] as const)("isRunning(%s) is %s", (phase, running) => {
    expect(store.isRunning(phase)).toBe(running);
  });

  it("stops guarding when the creator cancels", () => {
    start(false);
    store.cancelOriginalUpload(VIDEO_ID);
    expect(addListener).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  it("marks only an upload that ended as seen", async () => {
    start(false);
    store.markOriginalSeen(VIDEO_ID);
    expect(original()?.seen).toBe(false);
    latest().input.onPartsDone?.();
    store.markOriginalSeen(VIDEO_ID);
    expect(original()?.seen).toBe(false);

    latest().answer.resolve({ ok: false, code: "network" });
    await flush();
    store.markOriginalSeen(VIDEO_ID);
    expect(original()).toMatchObject({ phase: "error", seen: true });
  });

  it("reports progress at most every 100 ms, never going back", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    start(false);
    const { onProgress } = latest().input;
    onProgress?.(10, 100);
    onProgress?.(20, 100);
    onProgress?.(30, 100);
    expect(original()?.sent).toBe(0);
    vi.advanceTimersByTime(99);
    expect(original()?.sent).toBe(0);
    vi.advanceTimersByTime(1);
    expect(original()?.sent).toBe(30);

    onProgress?.(25, 100);
    vi.advanceTimersByTime(100);
    expect(original()?.sent).toBe(30);

    onProgress?.(60, 100);
    const before = state();
    vi.advanceTimersByTime(50);
    onProgress?.(70, 100);
    expect(state()).toBe(before);
    vi.advanceTimersByTime(50);
    expect(original()?.sent).toBe(70);
  });

  it("ignores the first upload's late answer after a Replace", async () => {
    start(false, video("first.mp4"));
    const first = latest();
    start(false, video("second.mp4"));
    const second = latest();
    expect(first.input.signal?.aborted).toBe(true);
    expect(second.input.signal?.aborted).toBe(false);

    first.input.onPartsDone?.();
    first.answer.resolve({ ok: false, code: "network" });
    await flush();
    expect(original()).toMatchObject({
      fileName: "second.mp4",
      phase: "uploading",
      error: null,
    });

    reads[1]?.resolve(meta(null));
    second.answer.resolve({ ok: true });
    await flush();
    expect(original()).toMatchObject({ fileName: "second.mp4", phase: "done" });
  });
});
