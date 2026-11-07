import "server-only";
import path from "node:path";
import { Font } from "@react-pdf/renderer";
import type { Font as FontkitFont } from "fontkit";

// The license PDF's fonts (known risk 20, owner-approved): Inter for Latin (Latin Extended and Vietnamese included),
// Greek and Cyrillic, then a Noto font for each script Inter lacks, embedded as subsets. react-pdf draws each code
// point with the first family in PDF_FONT_STACK that has it. The files and their OFL licenses are in ./fonts, read from
// the project root (next.config.ts ships them with the PDF route). fitWords and printable read the fonts react-pdf
// loaded, so each file is parsed once per process (the CJK one is 16 MB).

const FONT_DIR = path.join(process.cwd(), "src/server/pdf/fonts");

type PdfFamily = { family: string; regular: string; bold?: string };

/** A family with `{family}-Regular.ttf` and `{family}-Bold.ttf`. */
const twoWeights = (family: string): PdfFamily => ({
  family,
  regular: `${family}-Regular.ttf`,
  bold: `${family}-Bold.ttf`,
});

/** The stack's families in order. react-pdf draws a bold run of a one-file family with its regular (CSS's fallback). */
const FAMILIES: readonly PdfFamily[] = [
  twoWeights("Inter"),
  twoWeights("NotoSansArabic"),
  twoWeights("NotoSansHebrew"),
  twoWeights("NotoSansDevanagari"),
  twoWeights("NotoSansThai"),
  // Han, kana and Hangul (CFF OpenType).
  { family: "NotoSansCJK", regular: "NotoSansCJKsc-Regular.otf" },
  // Monochrome; the variable font's default instance.
  { family: "NotoEmoji", regular: "NotoEmoji.ttf" },
];

/** Every text's `fontFamily`; bold is `fontWeight: 700`. */
export const PDF_FONT_STACK = FAMILIES.map(({ family }) => family);

// `next dev` can run this module again after an edit; react-pdf's store, a package outside the bundle, outlives it.
const registered = new Set(Font.getRegisteredFontFamilies());
for (const { family, regular, bold } of FAMILIES) {
  if (registered.has(family)) continue;
  Font.register({
    family,
    fonts: [
      { src: path.join(FONT_DIR, regular), fontWeight: 400 },
      ...(bold ? [{ src: path.join(FONT_DIR, bold), fontWeight: 700 }] : []),
    ],
  });
}

type PdfWeight = 400 | 700;
type LoadedFont = Pick<
  FontkitFont,
  "hasGlyphForCodePoint" | "glyphForCodePoint" | "unitsPerEm" | "ascent"
>;

/** One weight of the stack, as the PDF measures it. */
export type PdfFace = {
  /** The family that draws `codePoint`, the first in the stack that has it: its index there, or -1 when none does. */
  family: (codePoint: number) => number;
  /** `codePoint`'s advance in ems in that family, or "?"'s in Inter when none has it (what printable prints). */
  advance: (codePoint: number) => number;
};

/** The stack at both weights. The bold files cover the code points their regular ones do (fonts.test.ts). */
export type PdfFonts = { regular: PdfFace; bold: PdfFace };

const QUESTION_MARK = 0x3f;

/**
 * react-pdf 4.9 sets a line's baseline at its tallest font's ascent but keeps the line's height, so a line with a
 * taller fallback font prints low, over the next line (Noto Sans Arabic's ascent is 1.37 em, Inter's 0.97). Each
 * fallback font reports Inter's ascent instead: every line sits on Inter's baseline.
 */
function shareBaseline([inter, ...fallbacks]: LoadedFont[]): void {
  for (const font of fallbacks) {
    // A one-file family's font is in both stacks.
    if (Object.hasOwn(font, "ascent")) continue;
    Object.defineProperty(font, "ascent", {
      value: (inter.ascent / inter.unitsPerEm) * font.unitsPerEm,
    });
  }
}

/** The stack at `weight`, loaded through react-pdf: the font objects its layout uses. */
async function loadStack(weight: PdfWeight): Promise<LoadedFont[]> {
  const stack = await Promise.all(
    PDF_FONT_STACK.map(async (fontFamily) => {
      const descriptor = { fontFamily, fontWeight: weight };
      await Font.load(descriptor);
      const { data } = Font.getFont(descriptor);
      if (!data) {
        throw new Error(`PDF font ${fontFamily} ${weight}: not loaded`);
      }
      return data;
    }),
  );
  shareBaseline(stack);
  return stack;
}

const ems = (font: LoadedFont, codePoint: number) =>
  font.glyphForCodePoint(codePoint).advanceWidth / font.unitsPerEm;

/** `stack` as a face, each code point looked up once. */
function face(stack: LoadedFont[]): PdfFace {
  const unknown = ems(stack[0], QUESTION_MARK);
  const glyphs = new Map<number, { family: number; advance: number }>();
  const glyph = (codePoint: number) => {
    let found = glyphs.get(codePoint);
    if (!found) {
      const family = stack.findIndex((f) => f.hasGlyphForCodePoint(codePoint));
      const advance = family === -1 ? unknown : ems(stack[family], codePoint);
      found = { family, advance };
      glyphs.set(codePoint, found);
    }
    return found;
  };
  return {
    family: (codePoint) => glyph(codePoint).family,
    advance: (codePoint) => glyph(codePoint).advance,
  };
}

async function loadFonts(): Promise<PdfFonts> {
  const [regular, bold] = await Promise.all([
    loadStack(400).then(face),
    loadStack(700).then(face),
  ]);
  return { regular, bold };
}

let fonts: Promise<PdfFonts> | null = null;

/** The PDF's fonts, loaded on the first call and kept for the process. */
export function pdfFonts(): Promise<PdfFonts> {
  fonts ??= loadFonts();
  return fonts;
}
