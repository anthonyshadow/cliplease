import { afterEach, describe, expect, it, vi } from "vitest";
import { initials } from "./initials";

describe("initials", () => {
  it("takes the first and the last word's first character, upper-cased", () => {
    expect(initials("Maya Ruiz")).toBe("MR");
    expect(initials("maya de la ruiz")).toBe("MR");
    expect(initials("Maya")).toBe("M");
  });

  it("ignores extra whitespace and gives nothing for a blank name", () => {
    expect(initials("  Maya \t  Ruiz \n")).toBe("MR");
    expect(initials("   ")).toBe("");
  });

  it("keeps a flag, a joined emoji and a decomposed accent whole", () => {
    expect(initials("🇧🇷 Studio")).toBe("🇧🇷S");
    expect(initials("👩‍🎤 Lima")).toBe("👩‍🎤L");
    expect(initials("élise Ruiz")).toBe("ÉR");
  });
});

describe("initials without Intl.Segmenter (Firefox before 125)", () => {
  const original = Intl.Segmenter;

  afterEach(() => {
    Object.defineProperty(Intl, "Segmenter", {
      value: original,
      configurable: true,
      writable: true,
    });
    vi.resetModules();
  });

  it("loads, and falls back to the first code point", async () => {
    Object.defineProperty(Intl, "Segmenter", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    vi.resetModules();
    const fresh = await import("./initials");
    expect(fresh.initials("ana lima")).toBe("AL");
    expect(fresh.initials("🇧🇷 Studio")).toBe("🇧S");
  });
});
