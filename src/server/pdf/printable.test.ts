import { describe, expect, it } from "vitest";
import {
  EMOJI_PAIR,
  SCRIPT_NAMES,
} from "../../../tests/helpers/license-snapshot-fixtures";
import { pdfFonts } from "./fonts";
import { printable } from "./printable";

// The license PDF's text as its fonts print it (known risk 20), with the embedded stack's own coverage.

const { regular } = await pdfFonts();
const print = (text: string) => printable(text, regular.family);
const ZWSP = "\u200B";

describe("printable", () => {
  it("keeps every character a font in the stack draws", () => {
    for (const name of SCRIPT_NAMES) {
      expect(print(name)).toEqual({ text: name, missing: false });
    }
    expect(print("Line one\nline two")).toEqual({
      text: "Line one\nline two",
      missing: false,
    });
  });

  it('prints a character no font has as "?" (Cherokee, Ol Chiki, Tifinagh)', () => {
    expect(print("Ꭰ Maya ᱚ ⴰ")).toEqual({ text: "? Maya ? ?", missing: true });
  });

  it("drops an invisible character no font has, and keeps one a font has", () => {
    // Word joiner, variation selector 1 and a language tag: in no font.
    expect(print("Ma\u2060ya\uFE00 \u{E0001}Films")).toEqual({
      text: "Maya Films",
      missing: false,
    });
    // ZWJ and ZWNJ (Noto Sans Arabic has both), and the emoji presentation selector (Noto Emoji).
    for (const text of ["क्\u200Dष", "می\u200Cخواهم", "❤\uFE0F"]) {
      expect(print(text)).toEqual({ text, missing: false });
    }
  });

  it("puts a zero-width space between two emoji in a row, never inside one", () => {
    expect(print(EMOJI_PAIR)).toEqual({ text: `🎬${ZWSP}🐶`, missing: false });
    expect(print("🇨🇦🇺🇸").text).toBe(`🇨🇦${ZWSP}🇺🇸`);
    expect(print("👍🏽🐶").text).toBe(`👍🏽${ZWSP}🐶`);
    expect(print("❤\uFE0F🐶").text).toBe(`❤\uFE0F${ZWSP}🐶`);
    expect(print("🎬\u2060🐶").text).toBe(`🎬${ZWSP}🐶`);
    for (const text of [
      "👍🏽",
      "🇨🇦",
      "🎬 🐶",
      "🎬王",
      "王小明",
      "™™",
      "1\uFE0F⃣",
    ]) {
      expect(print(text).text).toBe(text);
    }
  });
});
