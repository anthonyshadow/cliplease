// The uploaded file against the posts it claims to be (01 J5.10, 07 D39, D69): a length check the creator sees on Where
// posted, per verified post, before "These posts show this same video". Pure and client-safe.
import { formatDuration } from "../format";

/** A length is known when it is a positive, finite number: 0, NaN and Infinity are how "unknown" arrives. */
const known = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * Whether the file (milliseconds, from the browser or the stored `duration_ms`) and the post (`social_post.duration_sec`)
 * differ by more than 1 s (01 J5.10). False when either is unknown: Instagram gives no duration (04 §9.12), and some
 * browsers can't read the file's.
 */
export function durationMismatch(
  fileMs: number | null | undefined,
  postSec: number | null | undefined,
): boolean {
  return (
    known(fileMs) && known(postSec) && Math.abs(fileMs - postSec * 1000) > 1000
  );
}

/**
 * The Banner above the tick when the lengths differ (01 J5.10, 04 §11.10): "This file is 0:14 but the post is 0:38.
 * Make sure it's the same video."; null when they match or either is unknown. With `postLabel` (the post's platform,
 * when the block shows more than one verified post; owner answer Q-76 a, proposed copy) it names the post: "…but the
 * Demo post is 0:38…".
 */
export function durationMismatchMessage(
  fileMs: number | null | undefined,
  postSec: number | null | undefined,
  postLabel?: string,
): string | null {
  if (!known(fileMs) || !known(postSec) || !durationMismatch(fileMs, postSec)) {
    return null;
  }
  const post = postLabel === undefined ? "post" : `${postLabel} post`;
  return `This file is ${formatDuration(fileMs / 1000)} but the ${post} is ${formatDuration(postSec)}. Make sure it's the same video.`;
}
