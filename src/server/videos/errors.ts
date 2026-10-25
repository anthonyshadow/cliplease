import "server-only";
import type { RightsLock } from "../../lib/videos/rights";
import {
  AlreadyLicensableElsewhereError,
  NotPublicError,
  PostingsLockedError,
} from "../postings/errors";
import { SocialRateLimitError, SocialUpstreamError } from "../social/errors";

// The Make licensable refusals (02 §5.6; P11). Messages are fixed codes: never a title, a handle or a URL. The actions
// turn them into ActionResult codes with the two mappers at the bottom; the pages word them (01 J5.2–J5.4, 07 D18).
// AlreadyLicensableElsewhereError and NotPublicError live in src/server/postings/errors.ts (02 §5.12), shared with
// saveVideoPostings.

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

/** The video is missing, another creator's, or its id isn't a uuid. */
export class VideoNotFoundError extends Error {
  constructor() {
    super("video_not_found");
    this.name = "VideoNotFoundError";
  }
}

/** The same-video tick confirms the verified posts, so the video needs at least one verified posting (07 D69). */
export class NoVerifiedPostingError extends Error {
  constructor() {
    super("no_verified_posting");
    this.name = "NoVerifiedPostingError";
  }
}

/** The tick confirms a file, so the original must be `ready` first. */
export class OriginalNotReadyError extends Error {
  constructor() {
    super("original_not_ready");
    this.name = "OriginalNotReadyError";
  }
}

/** Delete draft on a video past its draft (02 §5.6): only a `draft` can be deleted. */
export class VideoNotDraftError extends Error {
  constructor() {
    super("video_not_draft");
    this.name = "VideoNotDraftError";
  }
}

/** An admin disabled the video: its details and answers can't change (02 §5.6). */
export class VideoDisabledError extends Error {
  constructor() {
    super("video_disabled");
    this.name = "VideoDisabledError";
  }
}

/** attestRights after a license was sold, or while a request waits (02 §6.1; owner answer Q-96 a). */
export class RightsLockedError extends Error {
  constructor(readonly lock: RightsLock) {
    super(`rights_locked_${lock}`);
    this.name = "RightsLockedError";
  }
}

/** Another of the creator's videos has this slug (video_creator_slug_uidx). */
export class SlugTakenError extends Error {
  constructor() {
    super("slug_taken");
    this.name = "SlugTakenError";
  }
}

/** The slug changed after the first publish (07 D09). */
export class SlugLockedError extends Error {
  constructor() {
    super("slug_locked");
    this.name = "SlugLockedError";
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

/** confirmSameVideo's and withdrawSameVideo's refusals as ActionResult codes. */
export type ConfirmSameVideoErrorCode =
  | "not_found"
  | "postings_locked"
  | "no_verified_posting"
  | "original_not_ready";

/**
 * The code for an error confirmSameVideo or withdrawSameVideo threw, or null for anything else (the action rethrows it).
 * `postings_locked` is the video no longer `draft` or `unpublished` ("Turn off to edit where it was posted.").
 */
export function confirmSameVideoErrorCode(
  error: unknown,
): ConfirmSameVideoErrorCode | null {
  if (error instanceof VideoNotFoundError) return "not_found";
  if (error instanceof PostingsLockedError) return "postings_locked";
  if (error instanceof NoVerifiedPostingError) return "no_verified_posting";
  if (error instanceof OriginalNotReadyError) return "original_not_ready";
  return null;
}
