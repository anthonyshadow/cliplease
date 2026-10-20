// Video slugs (01 J5.12, 07 D20): lowercase words joined by single hyphens, at most SLUG_MAX_LENGTH characters, unique per
// creator (the server adds the suffix). Pure and client-safe.
import { SLUG_MAX_LENGTH, SLUG_RE } from "../validation/handle";

const FALLBACK = "video";

/** Cuts `slug` to at most `max` characters, at a hyphen when there is one, and never leaves a hyphen at the end. */
function cut(slug: string, max: number): string {
  if (slug.length <= max) return slug;
  const head = slug.slice(0, max);
  // A hyphen right after the cut means the cut already fell on a word boundary.
  if (slug[max] === "-") return head;
  const hyphen = head.lastIndexOf("-");
  return (hyphen > 0 ? head.slice(0, hyphen) : head).replace(/-+$/, "");
}

/**
 * A title as a slug: NFKD, diacritics dropped, lowercase, every run of anything outside a–z and 0–9 one hyphen, no
 * hyphen at either end, at most 60 characters (cut at a hyphen when there is one). "video" when nothing is left.
 */
export function slugFromTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const result = cut(slug, SLUG_MAX_LENGTH);
  return SLUG_RE.test(result) ? result : FALLBACK;
}

/** `slug` with `-n` for n ≥ 2 (n = 1 is the slug itself), the base cut first so the result stays ≤ 60. */
export function withSlugSuffix(slug: string, n: number): string {
  if (n <= 1) return slug;
  const suffix = `-${n}`;
  return `${cut(slug, SLUG_MAX_LENGTH - suffix.length)}${suffix}`;
}
