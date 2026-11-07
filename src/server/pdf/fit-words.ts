import "server-only";
import type { PdfFace } from "./fonts";

// Long links and long words on the license PDF (05 §9; P20 audit PD-5). react-pdf breaks a line only at a space, and
// marks a hyphenation break with a "-" glyph, so a URL, or any word without a space (a licensee name, a title, a run of
// CJK), wider than its column would run off the page, or print altered if it were hyphenated. The PDF cuts each such
// word into lines by width instead: every character kept, none added. Widths are the embedded fonts' own advances
// (fonts.ts), each character's from the first font in the stack that has it.

/** A character's advance in points at `size` pt in `face`. */
const advance = (char: string, size: number, face: PdfFace) =>
  face.advance(char.codePointAt(0) ?? 0) * size;

/** `text`'s width in points at `size` pt in `face`, without kerning. */
export function textWidth(text: string, size: number, face: PdfFace): number {
  let width = 0;
  for (const char of text) width += advance(char, size, face);
  return width;
}

/** `word` as pieces no wider than `width` pt at `size` pt in `face`, in order; joined, they are the word again. */
function pieces(
  word: string,
  width: number,
  size: number,
  face: PdfFace,
): string[] {
  const lines: string[] = [];
  let line = "";
  let used = 0;
  for (const char of word) {
    const w = advance(char, size, face);
    if (line !== "" && used + w > width) {
      lines.push(line);
      line = "";
      used = 0;
    }
    line += char;
    used += w;
  }
  lines.push(line);
  return lines;
}

/**
 * `text` with each word (a run without a space or a line break) wider than `width` pt at `size` pt in `face` cut into
 * pieces on lines of their own, joined by "\n"; the spaces and the words that fit stay as they are, for react-pdf to
 * wrap.
 */
export function fitWords(
  text: string,
  width: number,
  size: number,
  face: PdfFace,
): string {
  return text.replace(/[^ \n]+/g, (word) =>
    textWidth(word, size, face) > width
      ? pieces(word, width, size, face).join("\n")
      : word,
  );
}
