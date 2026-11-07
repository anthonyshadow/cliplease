import { readdirSync } from "node:fs";
import path from "node:path";
import * as fontkit from "fontkit";
import { describe, expect, it } from "vitest";
import { PDF_FONT_STACK, pdfFonts } from "./fonts";

// The license PDF's embedded font stack (known risk 20): its order, its files' coverage, and which family draws what.

const FONT_DIR = path.join(process.cwd(), "src/server/pdf/fonts");

function openFont(file: string): fontkit.Font {
  const font = fontkit.openSync(path.join(FONT_DIR, file));
  if ("fonts" in font) throw new Error(`${file} is a collection`);
  return font;
}

const files = readdirSync(FONT_DIR).filter((file) => /\.(ttf|otf)$/.test(file));

describe("the PDF's fonts", () => {
  it("stack Inter first, then a Noto family per script, emoji last", () => {
    expect(PDF_FONT_STACK).toEqual([
      "Inter",
      "NotoSansArabic",
      "NotoSansHebrew",
      "NotoSansDevanagari",
      "NotoSansThai",
      "NotoSansCJK",
      "NotoEmoji",
    ]);
  });

  it("give each bold file the code points its regular one has, so coverage reads the regular stack", () => {
    const bolds = files.filter((file) => file.includes("-Bold."));
    expect(bolds).toHaveLength(5);
    for (const bold of bolds) {
      const regular = openFont(bold.replace("-Bold.", "-Regular."));
      expect(new Set(openFont(bold).characterSet), bold).toEqual(
        new Set(regular.characterSet),
      );
    }
  });

  it("draw each script with its family, and a letter no file has (Cherokee, Ol Chiki, Tifinagh) with none", async () => {
    const { regular, bold } = await pdfFonts();
    const family = (char: string) =>
      PDF_FONT_STACK[regular.family(char.codePointAt(0) ?? 0)];
    expect(["Ł", "ř", "ş", "ễ", "Ε", "Д", " ", "“", "•"].map(family)).toEqual(
      Array(9).fill("Inter"),
    );
    expect(
      ["م", "ד", "र", "ส", "王", "さ", "김", "🎬", "\uFE0F"].map(family),
    ).toEqual([
      "NotoSansArabic",
      "NotoSansHebrew",
      "NotoSansDevanagari",
      "NotoSansThai",
      "NotoSansCJK",
      "NotoSansCJK",
      "NotoSansCJK",
      "NotoEmoji",
      "NotoEmoji",
    ]);
    const fonts = files.map(openFont);
    for (const char of ["Ꭰ", "ᱚ", "ⴰ"]) {
      const codePoint = char.codePointAt(0) ?? 0;
      expect(fonts.some((font) => font.hasGlyphForCodePoint(codePoint))).toBe(
        false,
      );
      expect(regular.family(codePoint)).toBe(-1);
      expect(bold.family(codePoint)).toBe(-1);
    }
  });
});
