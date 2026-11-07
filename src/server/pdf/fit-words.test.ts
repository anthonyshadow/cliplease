import { describe, expect, it } from "vitest";
import { fitWords, textWidth } from "./fit-words";
import { pdfFonts } from "./fonts";

// Long links and long words on the license PDF (05 §9; P20 audit PD-5): cut by the embedded fonts' widths (known risk
// 20), every character kept, none added.

const { regular, bold } = await pdfFonts();

const lines = (text: string, width: number, size: number, face = regular) =>
  fitWords(text, width, size, face).split("\n");

describe("textWidth", () => {
  it("adds each character's advance in the first font of the stack that has it", () => {
    // Inter (2048 units an em): "W" 2018, "i" 496, " " 576; bold "W" 2125, "i" 555, " " 485.
    expect(textWidth("Wi i", 10, regular)).toBeCloseTo(
      ((2018 + 496 + 576 + 496) * 10) / 2048,
    );
    expect(textWidth("Wi i", 10, bold)).toBeCloseTo(
      ((2125 + 555 + 485 + 555) * 10) / 2048,
    );
    // Noto Sans CJK: an ideograph 1000 of 1000 units; Noto Emoji: 2600 of 2048.
    expect(textWidth("王小明", 10, regular)).toBeCloseTo(30);
    expect(textWidth("🎬🐶", 10, regular)).toBeCloseTo((2 * 2600 * 10) / 2048);
  });

  it('measures a character no font has as the "?" it prints as', () => {
    expect(textWidth("Ꭰ", 10, regular)).toBeCloseTo(
      textWidth("?", 10, regular),
    );
    expect(textWidth("Ꭰ", 10, bold)).toBeCloseTo(textWidth("?", 10, bold));
  });
});

describe("fitWords", () => {
  it("keeps a link, or words, that fit as they are", () => {
    const url = "https://www.instagram.com/reel/C9xQ2abc/";
    expect(fitWords(url, 420, 9.5, regular)).toBe(url);
    const text = `Daily Laughs Media ${"International Holdings ".repeat(6)}LLC`;
    expect(fitWords(text, 100, 9.5, regular)).toBe(text);
  });

  it("cuts by each character's width, at the weight it is drawn", () => {
    // "W" is 9.85 pt at 10 pt, 10.38 pt bold: 10 fit in 100 pt, 9 bold. "i" is 2.42 pt: 41 fit.
    expect(lines("W".repeat(25), 100, 10)).toEqual([
      "W".repeat(10),
      "W".repeat(10),
      "W".repeat(5),
    ]);
    expect(lines("W".repeat(25), 100, 10, bold)).toEqual([
      "W".repeat(9),
      "W".repeat(9),
      "W".repeat(7),
    ]);
    expect(lines("i".repeat(50), 100, 10)).toEqual([
      "i".repeat(41),
      "i".repeat(9),
    ]);
  });

  it("cuts a CJK run, which has no spaces, at the column, and an emoji run between its emoji", () => {
    // 10 pt an ideograph at 10 pt; 12.7 pt an emoji, so 7 fit in 100 pt.
    expect(lines("王小明".repeat(10), 100, 10)).toEqual([
      "王小明王小明王小明王",
      "小明王小明王小明王小",
      "明王小明王小明王小明",
    ]);
    expect(lines("🎬".repeat(10), 100, 10)).toEqual([
      "🎬".repeat(7),
      "🎬".repeat(3),
    ]);
  });

  it("cuts only the words wider than the column, keeping the spaces around them", () => {
    const name = "W".repeat(25);
    expect(fitWords(`Daily ${name} LLC`, 100, 10, regular)).toBe(
      `Daily ${"W".repeat(10)}\n${"W".repeat(10)}\n${"W".repeat(5)} LLC`,
    );
  });

  it("joins back to the whole text, with no hyphen added", () => {
    const url = `https://vimeo.com/123456?${"q=WWWW@@@abcdefghij&".repeat(100)}`;
    const text = `See ${url} and “${"Mi".repeat(200)}” for Łukasz Żółć.`;
    const fitted = fitWords(text, 414, 9.5, regular);
    expect(fitted.split("\n").length).toBeGreaterThan(20);
    expect(fitted.replaceAll("\n", "")).toBe(text);
    for (const line of fitted.split("\n")) {
      for (const word of line.split(" ")) {
        expect(textWidth(word, 9.5, regular)).toBeLessThanOrEqual(414);
      }
    }
  });
});
