import "server-only";

// The license PDF's text as its fonts print it (known risk 20, owner-approved), never the snapshot's. A character no
// font in the stack has is dropped when it is invisible (Unicode's default-ignorable code points: a variation selector,
// a stray joiner) and prints as "?" otherwise; the PDF then says the official record shows them exactly. A
// default-ignorable a font has stays: Arabic and Indic shaping read ZWJ and ZWNJ.
//
// Two emoji in a row drawn by one fallback font get a zero-width space between them. react-pdf 4.9 starts a text
// fragment after each emoji, and a fragment that starts inside one fallback font's run is drawn with the stack's first
// font, Inter, as missing-glyph boxes ("🎬🐶", two flags, "👍🏽🐶"). Inter draws the space, so the fragment starts there.

/** The family of the PDF's stack that draws `codePoint` (fonts.ts): its index there, or -1 when none does. */
export type FamilyOf = (codePoint: number) => number;

const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;
/** A character an emoji can end with: its pictograph, or a modifier, variation selector, keycap, tag or flag letter. */
const EMOJI_END = /[\p{Extended_Pictographic}\p{Emoji_Component}]/u;
/** A character that continues the emoji before it, unless it is a flag letter starting the next pair. */
const EMOJI_COMPONENT = /\p{Emoji_Component}/u;
const REGIONAL_INDICATOR = /\p{Regional_Indicator}/u;
const ZERO_WIDTH_SPACE = "\u200B";

/** `text` as the PDF prints it with `familyOf`'s fonts, "\n" kept as a line break; `missing` when a "?" printed. */
export function printable(
  text: string,
  familyOf: FamilyOf,
): { text: string; missing: boolean } {
  let printed = "";
  let missing = false;
  let last = { char: "", family: -1 };
  // Flag letters in a row so far: each flag is a pair.
  let indicators = 0;
  for (const char of text) {
    // No font has a line break, which react-pdf breaks the line at: it counts as Inter's, ending a run of emoji.
    const family = char === "\n" ? 0 : familyOf(char.codePointAt(0) ?? 0);
    if (family === -1 && DEFAULT_IGNORABLE.test(char)) continue;
    if (family === -1) {
      printed += "?";
      missing = true;
      last = { char: "?", family: 0 };
      indicators = 0;
      continue;
    }
    const indicator = REGIONAL_INDICATOR.test(char);
    const startsEmoji = indicator
      ? indicators % 2 === 0
      : !EMOJI_COMPONENT.test(char);
    if (
      family > 0 &&
      family === last.family &&
      EMOJI_END.test(last.char) &&
      startsEmoji
    ) {
      printed += ZERO_WIDTH_SPACE;
    }
    printed += char;
    last = { char, family };
    indicators = indicator ? indicators + 1 : 0;
  }
  return { text: printed, missing };
}
