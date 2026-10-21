// The title a Library video starts with (01 J5.12). Apart from ./title, so the client title form that imports TITLE_MAX
// doesn't bundle these rules.
import { untitledPostText } from "../library/post";
import { tidyTitle } from "./title";

/** 01 J5.12: a title taken from a post is at most 80 characters, cut at a word boundary. */
export const POST_TITLE_MAX = 80;

const LINE_BREAK = /\r\n|[\n\v\f\r\u0085\u2028\u2029]/;
// An emoji with what dresses it: a keycap ("1️⃣"), a flag (regional-indicator letters), or a pictograph with its skin
// tones, VS16, tag characters and ZWJ chain; then any of those parts left alone.
const EMOJI =
  /[#*0-9]\uFE0F?\u20E3|\p{Regional_Indicator}+|\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F|[\u{E0020}-\u{E007F}])*(?:\u200D\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F)*)*|\p{Emoji_Modifier}|\uFE0F|\u20E3/gu;
// A hashtag: # (or the fullwidth ＃) and a word with at least one letter, as the platforms link them; "#1" stays text.
const HASHTAG = /[#\uFF03][\p{L}\p{M}\p{N}_]*[\p{L}_][\p{L}\p{M}\p{N}_]*/gu;
// Where something was taken out (a private-use character, cleared from the text first).
const CUT = "\uE000";
// Brackets or quotes left holding nothing but what went ("(#fyp)", "[🎉]", "\"#dogs\""): they go too.
const EMPTIED_PAIR =
  /[([{][\s\uE000]*[)\]}]|(["'])[\s\uE000]*\1|“[\s\uE000]*”|‘[\s\uE000]*’/gu;
const CUT_BEFORE_PUNCTUATION = /\s*\uE000[\s\uE000]*(?=[,.!?;:…)\]]|$)/gu;
const CUT_ELSEWHERE = /\s*\uE000[\s\uE000]*/gu;
// Separators left hanging once a hashtag or emoji went: "Snow day - #dogs", "🎉 | Snow day".
const LEADING_SEPARATORS = /^(?:[-–—|·•:;,/]+\s+)+/u;
const TRAILING_SEPARATORS = /[\s\-–—|·•:;,/]+$/u;

const trimSeparators = (text: string) =>
  text.replace(LEADING_SEPARATORS, "").replace(TRAILING_SEPARATORS, "");

/** One line without hashtags or emoji: a word on each side of what went keeps a space, punctuation after it none. */
function withoutTagsAndEmoji(line: string): string {
  const marked = line
    .replaceAll(CUT, "")
    .replace(EMOJI, CUT)
    .replace(HASHTAG, CUT)
    .replace(EMPTIED_PAIR, CUT)
    .replace(CUT_BEFORE_PUNCTUATION, "")
    .replace(CUT_ELSEWHERE, " ");
  return trimSeparators(tidyTitle(marked));
}

// A character that can't start a cut: the second half of a surrogate pair, or a mark that belongs to the one before.
const NOT_A_START = /[\uDC00-\uDFFF]|\p{M}/u;

/** At most `max` characters, cut at the last space that fits; one longer word is cut inside, never mid-character. */
function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  // The character after the cut counts: a space there means the cut already falls between words.
  const space = text.slice(0, max + 1).lastIndexOf(" ");
  if (space > 0) return trimSeparators(text.slice(0, space));
  let end = max;
  while (end > 0 && NOT_A_START.test(text.charAt(end))) end--;
  return trimSeparators(text.slice(0, end));
}

/** The first non-blank line of `text` without hashtags or emoji, cut to POST_TITLE_MAX; "" when nothing is left. */
function firstLine(text: string | null): string {
  const line = text?.split(LINE_BREAK).find((l) => l.trim() !== "") ?? "";
  return cutAtWord(withoutTagsAndEmoji(line), POST_TITLE_MAX);
}

/**
 * The title a Library video starts with (01 J5.12): the post's title, else the first line of its caption, each with
 * hashtags and emoji removed, tidied (owner answer Q-43 a) and cut to 80 characters at a word boundary; when nothing
 * is left, "{Platform} video · 1 Oct 2026" (or "{Platform} video" without a date). Demo post 01 → "He saw snow for the
 * first time and lost it".
 */
export function titleFromPost(post: {
  title: string | null;
  caption: string | null;
  platformLabel: string;
  postedAt: Date | string | null;
}): string {
  return (
    firstLine(post.title) ||
    firstLine(post.caption) ||
    untitledPostText(post.platformLabel, post.postedAt)
  );
}
