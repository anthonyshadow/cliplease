// Text split by what a reader sees as one character, so an emoji, a flag or an accented letter stays whole. Pure and
// client-safe.

// Made on first use, and only where the engine has it: Firefox before 125 doesn't, so there code points stand in (a
// flag or a joined emoji then counts as several).
let segmenter: Intl.Segmenter | null | undefined;

/** `text`'s graphemes ("é🇨🇦" → ["é", "🇨🇦"]), or its code points where the engine has no Intl.Segmenter. */
export function graphemes(text: string): string[] {
  if (segmenter === undefined) {
    segmenter =
      typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;
  }
  return segmenter
    ? Array.from(segmenter.segment(text), (s) => s.segment)
    : Array.from(text);
}
