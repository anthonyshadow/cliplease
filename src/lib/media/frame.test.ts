import { describe, expect, it, vi } from "vitest";
import {
  encodeWithin,
  fitLongEdge,
  isBlankFrame,
  JPEG_QUALITIES,
  POSTER_LONG_EDGE,
  samplePoints,
  seekTime,
} from "./frame";

describe("seekTime (research/infra.md §3)", () => {
  it.each([
    [14, 1],
    [10, 1],
    [600, 1],
    [5, 0.5],
    [2, 0.2],
  ])("%s s → %s s", (duration, at) => {
    expect(seekTime(duration)).toBeCloseTo(at, 10);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0,
    -3,
  ])("%s → 0", (duration) => {
    expect(seekTime(duration)).toBe(0);
  });
});

describe("fitLongEdge", () => {
  it.each([
    [1920, 1080, 1080, 608],
    [1080, 1920, 608, 1080],
    [720, 1280, 608, 1080],
    [3840, 2160, 1080, 608],
    [2160, 2160, 1080, 1080],
    [1080, 1080, 1080, 1080],
    [640, 360, 640, 360],
    [10_000, 1, 1080, 1],
    [1, 10_000, 1, 1080],
  ])("%i × %i → %i × %i", (width, height, w, h) => {
    expect(fitLongEdge(width, height)).toEqual({ width: w, height: h });
  });

  it("keeps the aspect within rounding", () => {
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1350],
      [4000, 3000],
      [1234, 5678],
    ] as const) {
      const fit = fitLongEdge(width, height);
      const scale = POSTER_LONG_EDGE / Math.max(width, height);
      expect(Math.max(fit.width, fit.height)).toBe(POSTER_LONG_EDGE);
      expect(Math.abs(fit.width - width * scale)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(fit.height - height * scale)).toBeLessThanOrEqual(0.5);
    }
  });

  it("takes another long edge", () => {
    expect(fitLongEdge(1920, 1080, 480)).toEqual({ width: 480, height: 270 });
  });
});

describe("samplePoints", () => {
  it.each([
    [1080, 1920],
    [1920, 1080],
    [64, 36],
    [4, 4],
    [3, 5],
    [1, 1],
  ])("gives 16 points inside %i × %i", (width, height) => {
    const points = samplePoints(width, height);
    expect(points).toHaveLength(16);
    for (const { x, y } of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(height);
    }
  });

  it("spreads a 4 × 4 grid away from the edges", () => {
    const points = samplePoints(1080, 1920);
    expect(new Set(points.map((p) => `${p.x},${p.y}`)).size).toBe(16);
    expect([...new Set(points.map((p) => p.x))]).toEqual([135, 405, 675, 945]);
    expect([...new Set(points.map((p) => p.y))]).toEqual([
      240, 720, 1200, 1680,
    ]);
  });
});

/** 16 RGBA quads of `fill`, with `odd` at index 5 when given. */
function frame(
  fill: [number, number, number, number],
  odd?: [number, number, number, number],
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(16 * 4);
  for (let i = 0; i < 16; i += 1) rgba.set(fill, i * 4);
  if (odd) rgba.set(odd, 5 * 4);
  return rgba;
}

describe("isBlankFrame", () => {
  it.each([
    ["black", frame([0, 0, 0, 255])],
    ["near-black", frame([8, 8, 8, 255])],
    ["transparent", frame([0, 0, 0, 0])],
    ["transparent colour", frame([255, 0, 0, 0])],
    [
      "black with one transparent colour",
      frame([0, 0, 0, 255], [0, 200, 0, 0]),
    ],
  ])("%s → blank", (_, rgba) => {
    expect(isBlankFrame(rgba)).toBe(true);
  });

  it.each([
    ["white", frame([255, 255, 255, 255])],
    ["one coloured pixel", frame([0, 0, 0, 255], [200, 30, 30, 255])],
    ["one just-too-bright channel", frame([0, 0, 0, 255], [8, 8, 9, 255])],
    ["half-transparent colour", frame([0, 0, 0, 0], [255, 0, 0, 128])],
  ])("%s → not blank", (_, rgba) => {
    expect(isBlankFrame(rgba)).toBe(false);
  });
});

/** An encoder whose nth call returns a blob of `sizes[n]` bytes (null for none), recording the qualities asked for. */
function fakeEncoder(...sizes: (number | null)[]) {
  let calls = 0;
  return vi.fn(async (_quality: number): Promise<Blob | null> => {
    const size = sizes[calls];
    calls += 1;
    return size == null ? null : new Blob([new Uint8Array(size)]);
  });
}

const qualities = (encode: ReturnType<typeof fakeEncoder>) =>
  encode.mock.calls.map(([quality]) => quality);

describe("encodeWithin", () => {
  it("tries 0.82, then 0.7", () => {
    expect(JPEG_QUALITIES).toEqual([0.82, 0.7]);
  });

  it("keeps the first blob within the limit", async () => {
    const encode = fakeEncoder(100);
    const blob = await encodeWithin(encode, 100);
    expect(blob?.size).toBe(100);
    expect(qualities(encode)).toEqual([0.82]);
  });

  it("retries once at 0.7 when 0.82 is over", async () => {
    const encode = fakeEncoder(101, 60);
    const blob = await encodeWithin(encode, 100);
    expect(blob?.size).toBe(60);
    expect(qualities(encode)).toEqual([0.82, 0.7]);
  });

  it.each([
    ["both are over", [101, 101, 10]],
    ["the encoder gives nothing", [null, null, 10]],
  ])("returns null when %s, without a third try", async (_, sizes) => {
    const encode = fakeEncoder(...sizes);
    await expect(encodeWithin(encode, 100)).resolves.toBeNull();
    expect(qualities(encode)).toEqual([0.82, 0.7]);
  });

  it("uses 0.7 when 0.82 gives nothing", async () => {
    const encode = fakeEncoder(null, 50);
    const blob = await encodeWithin(encode, 100);
    expect(blob?.size).toBe(50);
  });
});
