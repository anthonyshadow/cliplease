import "server-only";
import { SocialRateLimitError, SocialUpstreamError } from "../social/errors";

// The Make licensable refusals (02 §5.6; P11). Messages are fixed codes: never a title, a handle or a URL. The actions
// turn them into ActionResult codes with the two mappers at the bottom; the pages word them (01 J5.2–J5.4, 07 D18).
// P11b moves AlreadyLicensableElsewhereError and NotPublicError to src/server/postings/errors.ts (02 §5.12), where
// saveVideoPostings shares them.

/** The post is missing, another creator's, or no longer `available` (createVideoFromPost step 1). */
export class PostNotFoundError extends Error {
  constructor() {
    super("post_not_found");
    this.name = "PostNotFoundError";
  }
}

/** The post's account isn't `connected`, or the platform refused its token during the live check (07 D12 b). */
export class NeedsReconnectError extends Error {
  constructor() {
    super("needs_reconnect");
    this.name = "NeedsReconnectError";
  }
}

/** The live check found no such post on the linked account (01 J5.2). */
export class NotOnAccountError extends Error {
  constructor() {
    super("not_on_account");
    this.name = "NotOnAccountError";
  }
}

/** The live post is private (07 D18): only public and unlisted posts can be made licensable. */
export class NotPublicError extends Error {
  constructor() {
    super("not_public");
    this.name = "NotPublicError";
  }
}

/** Another creator's video holds the verified posting of this platform post (07 D66, video_posting_verified_uidx). */
export class AlreadyLicensableElsewhereError extends Error {
  constructor() {
    super("already_licensable_elsewhere");
    this.name = "AlreadyLicensableElsewhereError";
  }
}

/** The video is missing, another creator's, or its id isn't a uuid. */
export class VideoNotFoundError extends Error {
  constructor() {
    super("video_not_found");
    this.name = "VideoNotFoundError";
  }
}

/** The same-video tick is for Library videos only until P11c widens it to any video with a verified posting (07 D69). */
export class NotFromLibraryError extends Error {
  constructor() {
    super("not_from_library");
    this.name = "NotFromLibraryError";
  }
}

/** The tick confirms a file, so the original must be `ready` first. */
export class OriginalNotReadyError extends Error {
  constructor() {
    super("original_not_ready");
    this.name = "OriginalNotReadyError";
  }
}

/** createVideoFromPost's refusals as ActionResult codes; `upstream` is the generic "Something went wrong. Try again.". */
export type MakeLicensableErrorCode =
  | "not_found"
  | "needs_reconnect"
  | "not_on_account"
  | "not_public"
  | "already_licensable_elsewhere"
  | "upstream";

/**
 * The code for an error createVideoFromPost threw, or null for anything else (a bug: the action rethrows it). A
 * platform that failed or rate-limited the live check is `upstream`: the Source page keeps Make licensable as the retry.
 */
export function makeLicensableErrorCode(
  error: unknown,
): MakeLicensableErrorCode | null {
  if (error instanceof PostNotFoundError) return "not_found";
  if (error instanceof NeedsReconnectError) return "needs_reconnect";
  if (error instanceof NotOnAccountError) return "not_on_account";
  if (error instanceof NotPublicError) return "not_public";
  if (error instanceof AlreadyLicensableElsewhereError) {
    return "already_licensable_elsewhere";
  }
  if (
    error instanceof SocialUpstreamError ||
    error instanceof SocialRateLimitError
  ) {
    return "upstream";
  }
  return null;
}

/** confirmSameVideo's refusals as ActionResult codes. */
export type ConfirmSameVideoErrorCode =
  | "not_found"
  | "not_from_library"
  | "original_not_ready";

/** The code for an error confirmSameVideo threw, or null for anything else (the action rethrows it). */
export function confirmSameVideoErrorCode(
  error: unknown,
): ConfirmSameVideoErrorCode | null {
  if (error instanceof VideoNotFoundError) return "not_found";
  if (error instanceof NotFromLibraryError) return "not_from_library";
  if (error instanceof OriginalNotReadyError) return "original_not_ready";
  return null;
}
