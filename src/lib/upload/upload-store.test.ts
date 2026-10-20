import type * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import {
  fakeNetwork,
  memoryStorage,
} from "../../../tests/helpers/upload-fakes";
import type { encodeImageToJpeg } from "../media/encode-image";
import type {
  readVideoMetadata,
  VideoMeta,
} from "../media/read-video-metadata";
import type { UploadResult } from "./http";
import { resumeHintKey } from "./resume";
import type { announceUploads, onOtherTabUploads } from "./tab-presence";
import type { uploadFile } from "./upload-file";
import type {
  abortOriginalUpload,
  UploadOriginalInput,
  uploadOriginal,
} from "./upload-original";
import type * as Store from "./upload-store";
import type { holdScreenWakeLock } from "./wake-lock";

const m = vi.hoisted(() => ({
  readVideoMetadata: vi.fn<typeof readVideoMetadata>(),
  encodeImageToJpeg: vi.fn<typeof encodeImageToJpeg>(),
  uploadFile: vi.fn<typeof uploadFile>(),
  uploadOriginal: vi.fn<typeof uploadOriginal>(),
  abortOriginalUpload: vi.fn<typeof abortOriginalUpload>(),
  announceUploads: vi.fn<typeof announceUploads>(),
  onOtherTabUploads: vi.fn<typeof onOtherTabUploads>(),
  holdScreenWakeLock: vi.fn<typeof holdScreenWakeLock>(),
}));

// browserNetwork and browserHints (localStorage): new fakes for each test, while each mock below is made once.
let network: ReturnType<typeof fakeNetwork>;
let hints: ReturnType<typeof memoryStorage>;

vi.mock("../media/read-video-metadata", () => ({
  readVideoMetadata: m.readVideoMetadata,
}));
vi.mock("../media/encode-image", () => ({
  encodeImageToJpeg: m.encodeImageToJpeg,
}));
vi.mock("./upload-file", () => ({ uploadFile: m.uploadFile }));
vi.mock("./upload-original", () => ({
  uploadOriginal: m.uploadOriginal,
  abortOriginalUpload: m.abortOriginalUpload,
  browserNetwork: {
    isOnline: () => network.isOnline(),
    onChange: (listener: (online: boolean) => void) =>
      network.onChange(listener),
  },
  browserHints: () => hints,
}));
vi.mock("./tab-presence", () => ({
  announceUploads: m.announceUploads,
  onOtherTabUploads: m.onOtherTabUploads,
}));
vi.mock("./wake-lock", () => ({ holdScreenWakeLock: m.holdScreenWakeLock }));
// useUploads is a hook: read the snapshot straight from getSnapshot, outside React.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useSyncExternalStore: <T>(_subscribe: unknown, getSnapshot: () => T) =>
    getSnapshot(),
}));

const VIDEO_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const HINT_KEY = resumeHintKey(VIDEO_ID);

let store: typeof Store;
let reads: PromiseWithResolvers<VideoMeta>[];
let originals: {
  input: UploadOriginalInput;
  answer: PromiseWithResolvers<UploadResult>;
}[];
let covers: PromiseWithResolvers<UploadResult>[];
let addListener: ReturnType<typeof vi.fn>;
let removeListener: ReturnType<typeof vi.fn>;
let locks: { release: Mock<() => void> }[];
let nav: { userAgent: string };
let doc: { visibilityState: string };

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

function start(
  captureCover: boolean,
  file = video(),
  videoId = VIDEO_ID,
  resume?: { uploadId: string | null; sent: number },
) {
  store.startOriginalUpload({
    videoId,
    title: "First snow",
    file,
    contentType: "video/mp4",
    captureCover,
    resume,
  });
}

/** The options of the nth readVideoMetadata call. */
const readOptions = (n: number) => m.readVideoMetadata.mock.calls[n]?.[2];

const fakeTimeouts = () =>
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

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
  m.abortOriginalUpload.mockResolvedValue(true);
  locks = [];
  m.holdScreenWakeLock.mockImplementation(() => {
    const lock = { release: vi.fn<() => void>() };
    locks.push(lock);
    return lock;
  });
  network = fakeNetwork();
  hints = memoryStorage();
  addListener = vi.fn();
  removeListener = vi.fn();
  nav = { userAgent: "test" };
  doc = { visibilityState: "visible" };
  vi.stubGlobal("window", {
    addEventListener: addListener,
    removeEventListener: removeListener,
  });
  vi.stubGlobal("navigator", nav);
  vi.stubGlobal("document", doc);
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
    expect(m.readVideoMetadata).toHaveBeenCalledTimes(1);
    await flush();
    expect(m.uploadFile).toHaveBeenCalledTimes(1);
    expect(cover()).toMatchObject({ phase: "done", origin: "frame_capture" });
  });

  it.each(["network", "internal", "unauthorized"] as const)(
    "resumes the open upload on Try again after %s, from the bytes sent",
    async (code) => {
      fakeTimeouts();
      const file = video();
      start(false, file);
      latest().input.onStarted?.("upload-1");
      latest().input.onProgress?.(40, 100);
      vi.advanceTimersByTime(100);
      latest().answer.resolve({ ok: false, code });
      await flush();
      expect(original()).toMatchObject({
        phase: "error",
        error: code,
        uploadId: "upload-1",
        sent: 40,
      });

      expect(store.retryOriginalUpload(VIDEO_ID, false)).toBe(true);
      expect(m.uploadOriginal).toHaveBeenCalledTimes(2);
      expect(latest().input).toMatchObject({
        resume: true,
        expectedUploadId: "upload-1",
      });
      expect(latest().input.file).toBe(file);
      expect(original()).toMatchObject({
        phase: "uploading",
        error: null,
        uploadId: "upload-1",
        sent: 40,
      });
    },
  );

  it.each([
    ["upload_expired", "upload_expired", "upload-1"],
    ["size_mismatch", "size_mismatch", "upload-1"],
    ["stale_upload", "stale_upload", "upload-1"],
    ["network before start answered", "network", null],
  ] as const)(
    "starts from zero on Try again after %s",
    async (_, code, uploadId) => {
      fakeTimeouts();
      const file = video();
      start(false, file);
      if (uploadId) latest().input.onStarted?.(uploadId);
      latest().input.onProgress?.(40, 100);
      vi.advanceTimersByTime(100);
      latest().answer.resolve({ ok: false, code });
      await flush();
      expect(original()).toMatchObject({ phase: "error", uploadId, sent: 40 });

      expect(store.retryOriginalUpload(VIDEO_ID, false)).toBe(true);
      expect(m.uploadOriginal).toHaveBeenCalledTimes(2);
      expect(latest().input.resume).toBeUndefined();
      expect(latest().input.expectedUploadId).toBeUndefined();
      expect(latest().input.file).toBe(file);
      expect(original()).toMatchObject({
        phase: "uploading",
        uploadId: null,
        sent: 0,
      });
    },
  );

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

  it("can't cancel once every part is in", async () => {
    hints.items.set(HINT_KEY, "hint");
    start(false);
    latest().input.onStatus?.("checking");
    await expect(store.cancelOriginalUpload(VIDEO_ID)).resolves.toBe(false);
    expect(original()).toMatchObject({ phase: "checking", sent: 100 });
    expect(latest().input.signal?.aborted).toBe(false);
    expect(hints.items.get(HINT_KEY)).toBe("hint");
    await flush();
    expect(m.abortOriginalUpload).not.toHaveBeenCalled();
  });

  it("completes as soon as the hints are known, without waiting for the frame", async () => {
    start(true);
    const hints = { durationMs: 14000, width: 720, height: 1280 };
    readOptions(0)?.onHints?.(hints);
    await expect(latest().input.meta).resolves.toEqual(hints);
    expect(cover()?.phase).toBe("capturing");

    latest().input.onStatus?.("checking");
    latest().answer.resolve({ ok: true });
    await flush();
    expect(original()).toMatchObject({ phase: "done", hints });
    expect(cover()?.phase).toBe("capturing");
  });

  it("reads the file once for a start and its resume: complete takes the hints already read", async () => {
    const hints = { durationMs: 14000, width: 720, height: 1280 };
    const file = video();
    start(false, file);
    reads[0]?.resolve(meta(null));
    latest().input.onStarted?.("upload-1");
    latest().answer.resolve({ ok: false, code: "paused" });
    await flush();

    expect(store.resumeOriginalUpload(VIDEO_ID)).toBe(true);
    expect(m.readVideoMetadata).toHaveBeenCalledTimes(1);
    await expect(latest().input.meta).resolves.toEqual(hints);
    latest().input.onStatus?.("checking");
    latest().answer.resolve({ ok: true });
    await flush();
    expect(original()).toMatchObject({ phase: "done", hints });
  });

  it.each<[string, () => void, boolean]>([
    ["the read failed", () => reads[0]?.reject(new Error("no video")), false],
    [
      "the read timed out",
      () =>
        reads[0]?.resolve({
          durationMs: null,
          width: null,
          height: null,
          poster: null,
        }),
      false,
    ],
    ["a frame is wanted", () => reads[0]?.resolve(meta(null)), true],
  ])(
    "reads the same file again on Try again when %s",
    async (_, read, captureCover) => {
      const file = video();
      start(false, file);
      read();
      latest().answer.resolve({ ok: false, code: "network" });
      await flush();

      expect(store.retryOriginalUpload(VIDEO_ID, captureCover)).toBe(true);
      expect(m.readVideoMetadata).toHaveBeenCalledTimes(2);
      expect(m.readVideoMetadata.mock.calls[1]?.[0]).toBe(file);
      expect(readOptions(1)?.poster).toBe(captureCover);
    },
  );

  it("ends done with the hints read from the file", async () => {
    start(false);
    reads[0]?.resolve(meta(frame));
    latest().input.onStatus?.("checking");
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

      latest().input.onStatus?.("checking");
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
    ["uploading", true, true],
    ["retrying", true, true],
    ["checking", true, true],
    ["paused", false, true],
    ["done", false, false],
    ["error", false, false],
    ["canceled", false, false],
  ] as const)("isRunning(%s) is %s, isLive %s", (phase, running, live) => {
    expect(store.isRunning(phase)).toBe(running);
    expect(store.isLive(phase)).toBe(live);
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
    latest().input.onStatus?.("checking");
    store.markOriginalSeen(VIDEO_ID);
    expect(original()?.seen).toBe(false);

    latest().answer.resolve({ ok: false, code: "network" });
    await flush();
    store.markOriginalSeen(VIDEO_ID);
    expect(original()).toMatchObject({ phase: "error", seen: true });
  });

  it("reports progress at most every 100 ms, never going back", () => {
    fakeTimeouts();
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

  it("shows the run's latest report at once when it pauses offline", () => {
    fakeTimeouts();
    start(false);
    const { onProgress, onStatus } = latest().input;
    onProgress?.(8, 100);
    vi.advanceTimersByTime(100);
    expect(original()?.sent).toBe(8);

    onProgress?.(24, 100);
    vi.advanceTimersByTime(50);
    onStatus?.("paused");
    expect(original()).toMatchObject({
      phase: "paused",
      pausedBy: "offline",
      sent: 24,
    });
    vi.advanceTimersByTime(50);
    expect(original()?.sent).toBe(24);
  });

  it("shows the run's latest report when a part runs out of retries, even below the bar", async () => {
    fakeTimeouts();
    start(false);
    const { onProgress } = latest().input;
    onProgress?.(40, 100);
    vi.advanceTimersByTime(100);
    onProgress?.(25, 100);
    expect(original()?.sent).toBe(40);

    latest().answer.resolve({ ok: false, code: "paused" });
    await flush();
    expect(original()).toMatchObject({
      phase: "paused",
      pausedBy: "retries",
      sent: 25,
    });
    vi.advanceTimersByTime(100);
    expect(original()?.sent).toBe(25);
  });

  it("replaces a resume's starting bytes with its first report, even below them", () => {
    fakeTimeouts();
    start(false, video(), VIDEO_ID, { uploadId: "upload-1", sent: 80 });
    expect(original()).toMatchObject({ uploadId: "upload-1", sent: 80 });

    const { onProgress } = latest().input;
    onProgress?.(64, 100);
    vi.advanceTimersByTime(100);
    expect(original()?.sent).toBe(64);
    // After the first, the bar never goes back.
    onProgress?.(50, 100);
    vi.advanceTimersByTime(100);
    expect(original()?.sent).toBe(64);
  });

  it("ignores the first upload's late answer after a Replace", async () => {
    start(false, video("first.mp4"));
    const first = latest();
    start(false, video("second.mp4"));
    const second = latest();
    expect(first.input.signal?.aborted).toBe(true);
    expect(second.input.signal?.aborted).toBe(false);

    first.input.onStatus?.("checking");
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

describe("retrying and paused (07 D80, owner answers Q-45, Q-46, Q-47)", () => {
  it("pauses while offline, dropping the leave guard and the wake lock", () => {
    start(false);
    const warn = addListener.mock.calls[0]?.[1];
    latest().input.onStatus?.("paused");
    expect(original()).toMatchObject({ phase: "paused", pausedBy: "offline" });
    expect(removeListener).toHaveBeenCalledWith("beforeunload", warn);
    expect(locks[0]?.release).toHaveBeenCalledTimes(1);
    // The running call goes on by itself once the browser is back.
    expect(latest().input.signal?.aborted).toBe(false);
  });

  it("comes back as uploading after a pause, shown on the card again", () => {
    start(false);
    latest().input.onStatus?.("paused");
    store.markOriginalSeen(VIDEO_ID);
    expect(original()?.seen).toBe(true);

    latest().input.onStatus?.("uploading");
    expect(original()).toMatchObject({
      phase: "uploading",
      pausedBy: null,
      seen: false,
    });
    expect(addListener).toHaveBeenCalledTimes(2);
    expect(m.holdScreenWakeLock).toHaveBeenCalledTimes(2);
  });

  it("pauses when a part ran out of retries", async () => {
    start(false);
    latest().answer.resolve({ ok: false, code: "paused" });
    await flush();
    expect(original()).toMatchObject({
      phase: "paused",
      pausedBy: "retries",
      error: null,
    });
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(locks[0]?.release).toHaveBeenCalledTimes(1);
  });

  it("resumes a retries pause with the same file and the open upload, from the bytes sent", async () => {
    fakeTimeouts();
    const file = video();
    start(false, file);
    const first = latest();
    first.input.onStarted?.("upload-1");
    first.input.onProgress?.(40, 100);
    vi.advanceTimersByTime(100);
    first.answer.resolve({ ok: false, code: "paused" });
    await flush();
    store.markOriginalSeen(VIDEO_ID);
    expect(original()).toMatchObject({
      phase: "paused",
      uploadId: "upload-1",
      sent: 40,
      seen: true,
    });

    expect(store.resumeOriginalUpload(VIDEO_ID)).toBe(true);
    expect(m.uploadOriginal).toHaveBeenCalledTimes(2);
    expect(latest().input).toMatchObject({
      resume: true,
      expectedUploadId: "upload-1",
    });
    expect(latest().input.file).toBe(file);
    expect(readOptions(1)?.poster).toBe(false);
    expect(original()).toMatchObject({
      phase: "uploading",
      uploadId: "upload-1",
      sent: 40,
      seen: false,
    });
  });

  it("resumes nothing that isn't paused", () => {
    expect(store.resumeOriginalUpload(VIDEO_ID)).toBe(false);
    start(false);
    expect(store.resumeOriginalUpload(VIDEO_ID)).toBe(false);
    expect(m.uploadOriginal).toHaveBeenCalledTimes(1);
  });

  it("resumes a retries pause by itself once the browser is back online", async () => {
    const file = video();
    start(false, file);
    latest().input.onStarted?.("upload-1");
    latest().answer.resolve({ ok: false, code: "paused" });
    await flush();

    network.set(false);
    expect(m.uploadOriginal).toHaveBeenCalledTimes(1);
    network.set(true);
    expect(m.uploadOriginal).toHaveBeenCalledTimes(2);
    expect(latest().input).toMatchObject({
      resume: true,
      expectedUploadId: "upload-1",
    });
    expect(latest().input.file).toBe(file);
    expect(original()?.phase).toBe("uploading");
  });

  it("leaves an offline pause to the running call when the browser is back", () => {
    start(false);
    network.set(false);
    latest().input.onStatus?.("paused");
    network.set(true);
    expect(m.uploadOriginal).toHaveBeenCalledTimes(1);
    expect(latest().input.signal?.aborted).toBe(false);
  });

  it("holds the screen wake lock and the leave guard only while the original runs", async () => {
    start(false);
    reads[0]?.resolve(meta(null));
    expect(m.holdScreenWakeLock).toHaveBeenCalledTimes(1);
    expect(m.holdScreenWakeLock).toHaveBeenCalledWith({ nav, doc });
    latest().input.onStatus?.("retrying");
    expect(removeListener).not.toHaveBeenCalled();
    latest().input.onStatus?.("uploading");
    latest().input.onStatus?.("checking");
    expect(m.holdScreenWakeLock).toHaveBeenCalledTimes(1);
    expect(locks[0]?.release).not.toHaveBeenCalled();

    latest().answer.resolve({ ok: true });
    await flush();
    expect(original()?.phase).toBe("done");
    expect(locks[0]?.release).toHaveBeenCalledTimes(1);
    expect(m.holdScreenWakeLock).toHaveBeenCalledTimes(1);
  });

  it("tells the other tabs which videos are running or paused", async () => {
    const announced = () =>
      [...(m.announceUploads.mock.lastCall?.[0] ?? [])].sort();
    start(false);
    expect(announced()).toEqual([VIDEO_ID]);
    start(false, video("b.mp4"), OTHER_ID);
    const second = latest();
    expect(announced()).toEqual([VIDEO_ID, OTHER_ID]);

    originals[0]?.answer.resolve({ ok: false, code: "paused" });
    await flush();
    expect(original()?.phase).toBe("paused");
    expect(announced()).toEqual([VIDEO_ID, OTHER_ID]);
    // One original still runs: the wake lock stays.
    expect(locks[0]?.release).not.toHaveBeenCalled();

    reads[1]?.resolve(meta(null));
    second.answer.resolve({ ok: true });
    await flush();
    expect(announced()).toEqual([VIDEO_ID]);
    expect(locks[0]?.release).toHaveBeenCalledTimes(1);

    await store.cancelOriginalUpload(VIDEO_ID);
    expect(announced()).toEqual([]);
  });
});

describe("another tab uploads the same video (owner answer Q-49)", () => {
  /** What tab-presence hears from another tab: the videos it uploads. */
  function otherTabUploads(videoIds: string[]) {
    const listener = m.onOtherTabUploads.mock.lastCall?.[0];
    if (!listener) throw new Error("onOtherTabUploads was not called");
    listener(videoIds);
  }

  it("listens from the first start, once", () => {
    expect(m.onOtherTabUploads).not.toHaveBeenCalled();
    start(false);
    start(false, video("b.mp4"), OTHER_ID);
    expect(m.onOtherTabUploads).toHaveBeenCalledTimes(1);
  });

  it.each<[string, () => Promise<void> | void]>([
    [
      "done",
      async () => {
        reads[0]?.resolve(meta(null));
        latest().input.onStatus?.("checking");
        latest().answer.resolve({ ok: true });
        await flush();
      },
    ],
    [
      "error",
      async () => {
        latest().answer.resolve({ ok: false, code: "network" });
        await flush();
      },
    ],
    [
      "canceled",
      () => {
        void store.cancelOriginalUpload(VIDEO_ID);
      },
    ],
  ])("drops an upload that ended %s here", async (phase, end) => {
    start(false);
    await end();
    expect(original()?.phase).toBe(phase);

    otherTabUploads([OTHER_ID, VIDEO_ID]);
    expect(original()).toBeUndefined();
  });

  it.each<[string, string, () => Promise<void> | void]>([
    ["uploading", "uploading", () => undefined],
    ["retrying", "retrying", () => latest().input.onStatus?.("retrying")],
    ["checking", "checking", () => latest().input.onStatus?.("checking")],
    ["paused offline", "paused", () => latest().input.onStatus?.("paused")],
    [
      "paused after retries",
      "paused",
      async () => {
        latest().answer.resolve({ ok: false, code: "paused" });
        await flush();
      },
    ],
  ])("keeps an upload that is %s here", async (_, phase, setup) => {
    start(false);
    await setup();
    expect(original()?.phase).toBe(phase);

    otherTabUploads([VIDEO_ID]);
    expect(original()?.phase).toBe(phase);
  });

  it("leaves the other videos as they are", async () => {
    start(false);
    latest().answer.resolve({ ok: false, code: "network" });
    start(false, video("b.mp4"), OTHER_ID);
    latest().answer.resolve({ ok: false, code: "network" });
    await flush();

    otherTabUploads([OTHER_ID]);
    expect(state().originals[OTHER_ID]).toBeUndefined();
    expect(original()?.phase).toBe("error");
  });
});

describe("Cancel (04 §9.26, 07 D80)", () => {
  beforeEach(() => {
    hints.items.set(HINT_KEY, "hint");
  });

  it.each<[string, () => void]>([
    ["uploading", () => undefined],
    ["retrying", () => latest().input.onStatus?.("retrying")],
    ["paused offline", () => latest().input.onStatus?.("paused")],
  ])(
    "while %s: forgets the hint at once and ends that upload on the server once the call has stopped",
    async (_, setup) => {
      start(false);
      latest().input.onStarted?.("upload-1");
      setup();
      const { input, answer } = latest();

      const canceled = store.cancelOriginalUpload(VIDEO_ID);
      expect(hints.items.has(HINT_KEY)).toBe(false);
      expect(input.signal?.aborted).toBe(true);
      expect(original()).toMatchObject({ phase: "canceled", seen: true });
      await flush();
      expect(m.abortOriginalUpload).not.toHaveBeenCalled();

      answer.resolve({ ok: false, code: "canceled" });
      await expect(canceled).resolves.toBe(true);
      expect(m.abortOriginalUpload).toHaveBeenCalledTimes(1);
      expect(m.abortOriginalUpload).toHaveBeenCalledWith(VIDEO_ID, "upload-1");
      expect(original()?.phase).toBe("canceled");
    },
  );

  it("while start still answers: names the upload that start opens (owner answer Q-50)", async () => {
    start(false);
    const canceled = store.cancelOriginalUpload(VIDEO_ID);
    latest().input.onStarted?.("upload-2");
    expect(original()).toMatchObject({ phase: "canceled", uploadId: null });

    latest().answer.resolve({ ok: false, code: "canceled" });
    await expect(canceled).resolves.toBe(true);
    expect(m.abortOriginalUpload).toHaveBeenCalledWith(VIDEO_ID, "upload-2");
  });

  it("names the resumed upload when the resume's start never answered", async () => {
    start(false, video(), VIDEO_ID, { uploadId: "upload-1", sent: 0 });
    const canceled = store.cancelOriginalUpload(VIDEO_ID);
    latest().answer.resolve({ ok: false, code: "network" });
    await expect(canceled).resolves.toBe(true);
    expect(m.abortOriginalUpload).toHaveBeenCalledWith(VIDEO_ID, "upload-1");
  });

  it("after a retries pause: ends that upload on the server at once", async () => {
    start(false);
    latest().input.onStarted?.("upload-1");
    latest().answer.resolve({ ok: false, code: "paused" });
    await flush();

    const canceled = store.cancelOriginalUpload(VIDEO_ID);
    expect(hints.items.has(HINT_KEY)).toBe(false);
    expect(original()).toMatchObject({ phase: "canceled", seen: true });
    await expect(canceled).resolves.toBe(true);
    expect(m.abortOriginalUpload).toHaveBeenCalledWith(VIDEO_ID, "upload-1");
  });

  it("with no upload in this tab (a reload left it paused): forgets the hint, names that upload and answers the server's word", async () => {
    m.abortOriginalUpload.mockResolvedValueOnce(false);
    const canceled = store.cancelOriginalUpload(VIDEO_ID, "paused-upload");
    expect(hints.items.has(HINT_KEY)).toBe(false);
    await expect(canceled).resolves.toBe(false);
    expect(m.abortOriginalUpload).toHaveBeenCalledWith(
      VIDEO_ID,
      "paused-upload",
    );
    expect(original()).toBeUndefined();
  });

  it("ends the upload on the server after 15 s when the running call never stops, unnamed if start never answered", async () => {
    fakeTimeouts();
    start(false);
    const canceled = store.cancelOriginalUpload(VIDEO_ID);
    vi.advanceTimersByTime(14_999);
    await flush();
    expect(m.abortOriginalUpload).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await expect(canceled).resolves.toBe(true);
    expect(m.abortOriginalUpload).toHaveBeenCalledTimes(1);
    expect(m.abortOriginalUpload).toHaveBeenCalledWith(VIDEO_ID, null);
  });

  it("tells the server once: not again once back online after an offline Cancel", async () => {
    m.abortOriginalUpload.mockResolvedValue(false);
    start(false);
    latest().input.onStarted?.("upload-1");
    network.set(false);
    latest().input.onStatus?.("paused");
    const canceled = store.cancelOriginalUpload(VIDEO_ID);
    latest().answer.resolve({ ok: false, code: "canceled" });
    await expect(canceled).resolves.toBe(false);
    expect(m.abortOriginalUpload).toHaveBeenCalledTimes(1);

    network.set(true);
    await flush();
    expect(m.abortOriginalUpload).toHaveBeenCalledTimes(1);
    expect(m.uploadOriginal).toHaveBeenCalledTimes(1);
    expect(original()?.phase).toBe("canceled");
  });

  it("lets the next start go without waiting for the abort: it names the old upload, so it can't end the new one (owner answer Q-50)", async () => {
    start(false);
    latest().input.onStarted?.("upload-1");
    const abort = Promise.withResolvers<boolean>();
    m.abortOriginalUpload.mockReturnValueOnce(abort.promise);
    void store.cancelOriginalUpload(VIDEO_ID);
    latest().answer.resolve({ ok: false, code: "canceled" });
    await flush();
    expect(m.abortOriginalUpload).toHaveBeenCalledWith(VIDEO_ID, "upload-1");

    start(false);
    expect(m.uploadOriginal).toHaveBeenCalledTimes(2);
    expect(original()?.phase).toBe("uploading");
    expect(latest().input.signal?.aborted).toBe(false);
    abort.resolve(true);
  });

  it("starts after a cancelled start has answered: answering later, it would replace the new upload on the server", async () => {
    start(false);
    const cancelled = latest();
    void store.cancelOriginalUpload(VIDEO_ID);
    start(false);
    expect(original()?.phase).toBe("uploading");
    await flush();
    expect(m.uploadOriginal).toHaveBeenCalledTimes(1);

    cancelled.input.onStarted?.("upload-1");
    cancelled.answer.resolve({ ok: false, code: "canceled" });
    await flush();
    expect(m.uploadOriginal).toHaveBeenCalledTimes(2);
    expect(latest().input.signal?.aborted).toBe(false);
    expect(m.abortOriginalUpload).toHaveBeenCalledWith(VIDEO_ID, "upload-1");
  });

  it("starts after 15 s and the unnamed abort when the cancelled start doesn't answer", async () => {
    fakeTimeouts();
    const abort = Promise.withResolvers<boolean>();
    m.abortOriginalUpload.mockReturnValueOnce(abort.promise);
    start(false);
    void store.cancelOriginalUpload(VIDEO_ID);
    start(false);
    vi.advanceTimersByTime(14_999);
    await flush();
    expect(m.uploadOriginal).toHaveBeenCalledTimes(1);

    // The abort then goes out unnamed, and it could end whatever is open: the start waits for it too.
    vi.advanceTimersByTime(1);
    await flush();
    expect(m.abortOriginalUpload).toHaveBeenCalledWith(VIDEO_ID, null);
    expect(m.uploadOriginal).toHaveBeenCalledTimes(1);

    abort.resolve(true);
    await flush();
    expect(m.uploadOriginal).toHaveBeenCalledTimes(2);
  });

  it("starts after 15 s more when the unnamed abort doesn't answer either", async () => {
    fakeTimeouts();
    m.abortOriginalUpload.mockReturnValueOnce(
      new Promise<boolean>(() => undefined),
    );
    start(false);
    void store.cancelOriginalUpload(VIDEO_ID);
    start(false);
    vi.advanceTimersByTime(15_000);
    await flush();
    vi.advanceTimersByTime(14_999);
    await flush();
    expect(m.uploadOriginal).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await flush();
    expect(m.uploadOriginal).toHaveBeenCalledTimes(2);
  });

  it("ends nothing for a start cancelled before it went out", async () => {
    start(false);
    const first = latest();
    void store.cancelOriginalUpload(VIDEO_ID);
    start(false);
    const second = store.cancelOriginalUpload(VIDEO_ID);
    first.input.onStarted?.("upload-1");
    first.answer.resolve({ ok: false, code: "canceled" });
    await expect(second).resolves.toBe(true);
    expect(m.uploadOriginal).toHaveBeenCalledTimes(1);
    expect(m.abortOriginalUpload).toHaveBeenCalledTimes(1);
    expect(m.abortOriginalUpload).toHaveBeenCalledWith(VIDEO_ID, "upload-1");
    expect(original()?.phase).toBe("canceled");
  });

  it("keeps a fresh upload's abort unnamed when its start never answered, not naming the page's older paused upload", async () => {
    start(false);
    const canceled = store.cancelOriginalUpload(VIDEO_ID, "paused-upload");
    latest().answer.resolve({ ok: false, code: "network" });
    await expect(canceled).resolves.toBe(true);
    expect(m.abortOriginalUpload).toHaveBeenCalledWith(VIDEO_ID, null);
  });
});
