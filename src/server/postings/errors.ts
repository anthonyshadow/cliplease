import "server-only";

// The postings refusals (02 §5.12; P11b), shared by createVideoFromPost, saveVideoPostings and recheckPosting.
// Messages are fixed codes: never a title, a handle, a link or a link key. The pages word them (01 J5.2–J5.4,
// J5.23–J5.28). The two cross-creator refusals of a save carry the refused row's `index` in the input (owner answer
// Q-78 a: the step shows them under that link field); Check again's, createVideoFromPost's and a lost index's carry none.

/**
 * Another creator's video holds this platform post (07 D66, D68): its verified posting, or a lost
 * video_posting_verified_uidx. A paste is refused whether or not it would verify.
 */
export class AlreadyLicensableElsewhereError extends Error {
  constructor(readonly index?: number) {
    super("already_licensable_elsewhere");
    this.name = "AlreadyLicensableElsewhereError";
  }
}

/** The creator's other video holds this platform post verified (07 D68); `videoTitle` names it in the copy. */
export class AlreadyOnYourVideoError extends Error {
  constructor(
    readonly videoTitle: string,
    readonly index?: number,
  ) {
    super("already_on_your_video");
    this.name = "AlreadyOnYourVideoError";
  }
}

/** The live post is private (07 D18): only public and unlisted posts can be made licensable or verified. */
export class NotPublicError extends Error {
  constructor() {
    super("not_public");
    this.name = "NotPublicError";
  }
}

/** The video isn't `draft` or `unpublished`, so its postings can't change ("Turn off to edit where it was posted."). */
export class PostingsLockedError extends Error {
  constructor() {
    super("postings_locked");
    this.name = "PostingsLockedError";
  }
}

/**
 * Check again within POSTING_CHECK_COOLDOWN_MS of the posting's last check (owner answer Q-84 a): that result stands and
 * the platform isn't asked ("Checked a moment ago. Try again in a few seconds.").
 */
export class CheckedRecentlyError extends Error {
  constructor() {
    super("checked_recently");
    this.name = "CheckedRecentlyError";
  }
}

/**
 * Why a set of postings is refused whole: over POSTINGS_MAX with the source, `notPosted` on a Library video, or nothing
 * chosen on a video with no source posting (no rows and not `notPosted`: "Say where it was posted").
 */
export type InvalidPostingsCode =
  | "too_many"
  | "not_posted_library"
  | "nothing_chosen";

/** A set of postings saveVideoPostings refuses before any parse, platform call or write. */
export class InvalidPostingsError extends Error {
  constructor(readonly code: InvalidPostingsCode) {
    super(code);
    this.name = "InvalidPostingsError";
  }
}
