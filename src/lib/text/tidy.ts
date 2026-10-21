// The tidy-up for typed text that others read: video titles and display names (owner answer Q-43 a). Pure and
// client-safe, with no Zod.

// Control characters (C0, DEL, C1), the marks that flip or isolate text direction (U+061C, U+200E/F, U+202A-U+202E,
// U+2066-U+2069) and the characters that only hide (soft hyphen, zero-width space, word joiner, BOM). The joiners
// U+200C/D stay: emoji sequences and some scripts need them.
const INVISIBLE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;
// Nothing a reader would see: spaces, format characters, default-ignorable ones (fillers such as U+3164, variation
// selectors, tag characters) and the blank Braille pattern U+2800. Only a text made of these alone is empty: inside
// real text they stay, since emoji sequences and some scripts need them.
const NOTHING_VISIBLE = /^[\p{Cf}\p{Default_Ignorable_Code_Point}\s\u2800]*$/u;
const BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]/g;

/**
 * Text as stored (owner answer Q-43 a): line breaks and tabs become spaces, other control, direction and invisible
 * marks go, runs of whitespace become one space, and the ends are trimmed; "" when nothing visible is left. Public
 * pages, emails and license PDFs show it as is.
 */
export function tidyText(raw: string): string {
  const tidy = raw
    .replace(BREAKS, " ")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim();
  return NOTHING_VISIBLE.test(tidy) ? "" : tidy;
}
