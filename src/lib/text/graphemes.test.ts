import { afterEach, describe, expect, it, vi } from "vitest";
import { graphemes } from "./graphemes";

describe("graphemes", () => {
  it("splits plain text into its characters, and nothing into nothing", () => {
    expect(graphemes("clip.mp4")).toEqual(Array.from("clip.mp4"));
    expect(graphemes("")).toEqual([]);
  });

  it.each([
    ["an emoji", "🎬"],
    ["a joined emoji", "👨‍👩‍👧"],
    ["a flag", "🇨🇦"],
    ["a decomposed accent", "é"],
  ])("keeps %s whole", (_, character) => {
    expect(graphemes(`a${character}b`)).toEqual(["a", character, "b"]);
  });
});

describe("graphemes without Intl.Segmenter (Firefox before 125)", () => {
  const original = Intl.Segmenter;

  afterEach(() => {
    Object.defineProperty(Intl, "Segmenter", {
      value: original,
      configurable: true,
      writable: true,
    });
    vi.resetModules();
  });

  it("loads, and splits into code points, never cutting one in two", async () => {
    Object.defineProperty(Intl, "Segmenter", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    vi.resetModules();
    const fresh = await import("./graphemes");
    expect(fresh.graphemes("a🎬b")).toEqual(["a", "🎬", "b"]);
    expect(fresh.graphemes("🇨🇦")).toEqual(["🇨", "🇦"]);
  });
});
