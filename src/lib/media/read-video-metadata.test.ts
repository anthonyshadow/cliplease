import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readVideoMetadata } from "./read-video-metadata";

let log: string[];
let canvases: ReturnType<typeof fakeCanvas>[];
let gridPixels: Uint8ClampedArray;

/** A <video> that answers its src with loadedmetadata (or error, or nothing) and each seek with seeked. */
class FakeVideo extends EventTarget {
  muted = false;
  playsInline = false;
  preload = "";
  duration = 14;
  videoWidth = 720;
  videoHeight = 1280;
  readyState = 4;
  plays = 0;
  answer: "loadedmetadata" | "error" | null = "loadedmetadata";
  seeks: number[] = [];
  private time = 0;

  get currentTime() {
    return this.time;
  }

  set currentTime(time: number) {
    this.time = time;
    this.seeks.push(time);
    setTimeout(() => this.dispatchEvent(new Event("seeked")), 0);
  }

  set src(_url: string) {
    const { answer } = this;
    if (answer) setTimeout(() => this.dispatchEvent(new Event(answer)), 0);
  }

  removeAttribute(name: string) {
    log.push(`removeAttribute ${name}`);
  }

  load() {
    log.push("load");
  }

  play() {
    this.plays += 1;
    return Promise.resolve();
  }

  pause() {}
}

function fakeCanvas() {
  const context = {
    drawImage: vi.fn((..._args: unknown[]) => {}),
    getImageData: vi.fn((..._args: number[]) => ({ data: gridPixels })),
  };
  return {
    width: 0,
    height: 0,
    context,
    getContext: () => context,
    toBlob: (done: (blob: Blob | null) => void) => {
      log.push("encode");
      done(new Blob(["jpeg"], { type: "image/jpeg" }));
    },
  };
}

let video: FakeVideo;
const file = new File([new Uint8Array(10)], "a.mp4", { type: "video/mp4" });
const onHints = vi.fn((_hints: unknown) => {
  log.push("hints");
});

beforeEach(() => {
  log = [];
  canvases = [];
  gridPixels = new Uint8ClampedArray(64).fill(200);
  video = new FakeVideo();
  onHints.mockClear();
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag === "video") return video;
      const canvas = fakeCanvas();
      canvases.push(canvas);
      return canvas;
    },
  });
  vi.stubGlobal("HTMLMediaElement", { HAVE_CURRENT_DATA: 2 });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:video");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {
    log.push("revoke");
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("readVideoMetadata (research/infra.md §3)", () => {
  it("tells the hints once, before the frame, and returns the cover", async () => {
    const meta = await readVideoMetadata(file, 15_000, { onHints });
    expect(meta).toEqual({
      durationMs: 14000,
      width: 720,
      height: 1280,
      poster: expect.any(Blob),
    });
    expect(onHints).toHaveBeenCalledTimes(1);
    expect(onHints).toHaveBeenCalledWith({
      durationMs: 14000,
      width: 720,
      height: 1280,
    });
    expect(video.seeks).toEqual([1]);
    expect(log).toEqual([
      "hints",
      "encode",
      "removeAttribute src",
      "load",
      "revoke",
    ]);
  });

  it("samples the frame with one pixel read", async () => {
    await readVideoMetadata(file);
    const [frame, grid] = canvases;
    expect(frame).toMatchObject({ width: 608, height: 1080 });
    expect(frame?.context.getImageData).not.toHaveBeenCalled();
    expect(grid).toMatchObject({ width: 4, height: 4 });
    expect(grid?.context.drawImage).toHaveBeenCalledTimes(16);
    expect(grid?.context.drawImage.mock.calls[5]).toEqual([
      frame,
      ...[228, 405, 1, 1],
      ...[1, 1, 1, 1],
    ]);
    expect(grid?.context.getImageData.mock.calls).toEqual([[0, 0, 4, 4]]);
  });

  it("leaves no timer once it has the frame, even after starting playback to paint it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    video.readyState = 1;
    let settled = false;
    const reading = readVideoMetadata(file).finally(() => {
      settled = true;
    });
    while (!settled) await vi.advanceTimersByTimeAsync(1);
    const meta = await reading;
    expect(meta.poster).toEqual(expect.any(Blob));
    expect(video.plays).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refuses a black frame", async () => {
    gridPixels = new Uint8ClampedArray(64);
    const meta = await readVideoMetadata(file);
    expect(meta).toMatchObject({ poster: null, posterError: "blank_frame" });
  });

  it("ends after the hints with poster: false", async () => {
    const meta = await readVideoMetadata(file, 15_000, {
      poster: false,
      onHints,
    });
    expect(meta).toEqual({
      durationMs: 14000,
      width: 720,
      height: 1280,
      poster: null,
    });
    expect(onHints).toHaveBeenCalledTimes(1);
    expect(video.seeks).toEqual([]);
    expect(canvases).toEqual([]);
    expect(log).toEqual(["hints", "removeAttribute src", "load", "revoke"]);
  });

  it("tells the duration alone for a video it can't decode", async () => {
    video.videoWidth = 0;
    video.videoHeight = 0;
    const meta = await readVideoMetadata(file, 15_000, { onHints });
    expect(meta).toMatchObject({ posterError: "unsupported_codec" });
    expect(onHints).toHaveBeenCalledTimes(1);
    expect(onHints).toHaveBeenCalledWith({
      durationMs: 14000,
      width: null,
      height: null,
    });
  });

  it.each([
    ["error", "decode_error"],
    [null, "timeout"],
  ] as const)(
    "tells nulls once when the metadata answers %s",
    async (answer, posterError) => {
      video.answer = answer;
      const meta = await readVideoMetadata(file, 20, { onHints });
      expect(meta).toEqual({
        durationMs: null,
        width: null,
        height: null,
        poster: null,
        posterError,
      });
      expect(onHints).toHaveBeenCalledTimes(1);
      expect(onHints).toHaveBeenCalledWith({
        durationMs: null,
        width: null,
        height: null,
      });
      expect(log.slice(-3)).toEqual(["removeAttribute src", "load", "revoke"]);
    },
  );
});
