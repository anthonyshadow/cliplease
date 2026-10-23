import "server-only";
import { and, eq, gt, isNotNull, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../../db/client";
import { socialAccount, video, videoPosting } from "../../db/schema";
import type { NewVideoPosting, VideoPosting } from "../../db/schema/types";
import {
  isOneOf,
  POSTING_PLATFORMS,
  type PostingLinkError,
  type PostingPlatform,
  type PostingUnverifiedReason,
  VERIFIABLE_POSTING_PLATFORMS,
} from "../../lib/domain/values";
import { POSTINGS_EDITABLE } from "../../lib/postings/form";
import {
  POSTING_OTHER_LABEL_MAX,
  POSTING_URL_MAX,
  POSTINGS_MAX,
} from "../../lib/postings/limits";
import { type PlannedPosting, planPostings } from "../../lib/postings/plan";
import type { OwnerPostingDTO } from "../../lib/postings/types";
import { tidiedText } from "../../lib/validation/tidied-text";
import { isUuid } from "../../lib/validation/uuid";
import { writeAudit } from "../audit";
import {
  type Actor,
  type CreatorActor,
  requireCreatorActor,
} from "../auth/actor";
import { mockEnabled } from "../social/registry";
import { VideoNotFoundError } from "../videos/errors";
import {
  stepFactColumns,
  stepFactsOf,
  type VideoStepState,
} from "../videos/queries";
import {
  CheckedRecentlyError,
  InvalidPostingsError,
  NotPublicError,
  PostingsLockedError,
} from "./errors";
import {
  assertPostingAvailable,
  assertPostingsAvailable,
  auditNewlyVerified,
  type PostingTarget,
  postKey,
  refreshVideoOwnership,
  verifiedKeys,
  verifiedPostingConflictError,
} from "./ownership";
import { getOwnerPosting, listVideoPostings } from "./queries";
import {
  type PostingCheckResult,
  type PostingDeadline,
  postingDeadline,
  verifyPostingLink,
} from "./verify";

// "Where was it posted?" writes (02 §5.12, §6.1; 03 §5.2; 06 §5b; 07 D66, D68, D69): saveVideoPostings and Check again.
// Every link is read again here (planPostings, the rule the Continue's postingsInputChanged compares with; the browser's
// parse is never trusted) and checked by id outside any transaction, a save's checks sharing one deadline and Check
// again having its own (POSTING_CHECKS_BUDGET_MS, owner answer Q-82 a); then one transaction locks the video, checks it
// and the cross-creator rule again, writes the postings, audits conflicts (auditNewlyVerified) and calls
// refreshVideoOwnership. A post checked within POSTING_CHECK_COOLDOWN_MS keeps its last result with no call (Q-84 a). A
// posting verified on this video keeps its verified fields when a check of it fails (owner answer Q-69 a: only
// checked_at moves), when the account it was verified through isn't connected now (Q-70 a: no check runs, so checked_at
// stays too) or when the deadline came before its turn (Q-82 a, no check either). "Show buyers this link" follows the
// post across saves (Q-86 a, chosenShowLink): the step posts a Switch only once the creator turned it. The is_source
// posting is never deleted or replaced here. Postings change only while the video is off (POSTINGS_EDITABLE: "Turn off
// to edit where it was posted."). Audits carry platforms and counts, never a link or a link key.

/** How long a posting's last check stands before the platform is asked about it again (owner answer Q-84 a). */
export const POSTING_CHECK_COOLDOWN_MS = 30_000;

/** Reasons that leave a posting verified on this video verified (Q-69 a, Q-70 a). A not_found is a real downgrade. */
const KEEPS_VERIFIED: readonly PostingUnverifiedReason[] = [
  "check_failed",
  "no_account",
];
/** Reasons given without a check: no checked_at. */
const NOT_CHECKED: readonly PostingUnverifiedReason[] = [
  "unverifiable",
  "no_link",
];

/**
 * Whether a check that didn't verify leaves a posting verified on this video verified (Q-69 a, Q-70 a). Of the two,
 * only Q-69 a's check_failed ran a check (checked_at moves); no_account made no platform call.
 */
function keepsVerified(
  check: Extract<PostingCheckResult, { verification: "unverified" }>,
): boolean {
  return KEEPS_VERIFIED.includes(check.reason);
}

/**
 * What a posting verified through an account that is no longer connected checks as: nothing to ask, so no check runs
 * (Q-70 a). A posting this video holds verified keeps its verified fields and its checked_at for it.
 */
const NO_ACCOUNT: PostingCheckResult = {
  verification: "unverified",
  reason: "no_account",
};

/** An account of the creator, for checkedRecently's "(re)connected or synced since" test. */
const since = alias(socialAccount, "since");

/**
 * Whether a posting's last check still stands (owner answer Q-84 a), by the database clock: checked within
 * POSTING_CHECK_COOLDOWN_MS, and no account of the creator on its platform (re)connected or synced since. Either makes
 * the last answer stale, so the platform is asked: Q-74 a's check after Link / Reconnect {Platform}, and Sync and check
 * again.
 */
const checkedRecently = sql<boolean>`(${videoPosting.checkedAt} is not null
  and ${videoPosting.checkedAt} > now() - make_interval(secs => ${POSTING_CHECK_COOLDOWN_MS / 1000})
  and ${notExists(
    db
      .select({ id: since.id })
      .from(since)
      .where(
        and(
          eq(since.creatorId, videoPosting.creatorId),
          sql`${since.provider}::text = ${videoPosting.platform}::text`,
          or(
            gt(since.connectedAt, videoPosting.checkedAt),
            gt(since.lastSyncedAt, videoPosting.checkedAt),
          ),
        ),
      ),
  )})`;

/**
 * A saved posting's two reasons to ask no platform, selected with it (left-joined to its verifying social_account):
 * `unlinked`, verified through an account that isn't connected now, so it keeps its verified fields with no check
 * (Q-70 a: another account on that platform can't see the post, so its not_found would be no answer); `recent`, its
 * last check still stands (checkedRecently, Q-84 a).
 */
const checkFlags = {
  unlinked: sql<boolean>`coalesce(${videoPosting.verification} = 'verified' and ${socialAccount.status} <> 'connected', false)`,
  recent: checkedRecently,
};

/** checkFlags as read. */
type CheckFlags = { unlinked: boolean; recent: boolean };

/**
 * Save step 5's one read: checkFlags of the video's saved non-source posts, by `platform:link_key`. The save never
 * checks a copy of the source posting (planPostings drops one); Check again reads the flags with its posting.
 */
async function savedCheckFlags(
  videoId: string,
): Promise<Map<string, CheckFlags>> {
  const rows = await db
    .select({
      platform: videoPosting.platform,
      linkKey: videoPosting.linkKey,
      ...checkFlags,
    })
    .from(videoPosting)
    .leftJoin(socialAccount, eq(socialAccount.id, videoPosting.socialAccountId))
    .where(
      and(
        eq(videoPosting.videoId, videoId),
        eq(videoPosting.isSource, false),
        isNotNull(videoPosting.linkKey),
      ),
    );
  return new Map(
    rows.flatMap(({ platform, linkKey, unlinked, recent }) =>
      linkKey === null
        ? []
        : [[postKey(platform, linkKey), { unlinked, recent }] as const],
    ),
  );
}

/**
 * One posting's check outside any transaction, under `deadline` (save step 5, Check again step 3): an `unlinked` one
 * (checkFlags) is NO_ACCOUNT with no call (Q-70 a); any other goes to verifyPostingLink.
 */
async function checkPosting(
  creatorId: string,
  row: {
    platform: PostingPlatform;
    linkKey: string | null;
    url: string | null;
  },
  unlinked: boolean,
  deadline: PostingDeadline,
): Promise<PostingCheckResult> {
  if (unlinked) return NO_ACCOUNT;
  return verifyPostingLink(creatorId, row, deadline);
}

/**
 * How save step 5 left a row unchecked: `carried`, its post checked within POSTING_CHECK_COOLDOWN_MS, so the saved
 * row's verification is kept as it is (Q-84 a); `not_reached`, the checks' budget ran out before its turn, so it is
 * check_failed with no call (Q-82 a). newPostingColumns writes both.
 */
export type UncheckedRow = "carried" | "not_reached";

/** A row as save step 5 leaves it: a check's result, or how it went unchecked. */
export type RowCheck = PostingCheckResult | UncheckedRow;

/**
 * Save step 5 for one planned row: carried when its post's saved check is recent, else checkPosting under the save's
 * one deadline. A link the deadline stopped before any platform call (notReached) is not_reached: not checked.
 */
async function checkRow(
  creatorId: string,
  row: PlannedPosting,
  saved: ReadonlyMap<string, CheckFlags>,
  deadline: PostingDeadline,
): Promise<RowCheck> {
  const flags =
    row.linkKey === null
      ? undefined
      : saved.get(postKey(row.platform, row.linkKey));
  if (flags?.recent) return "carried";
  const check = await checkPosting(
    creatorId,
    row,
    flags?.unlinked ?? false,
    deadline,
  );
  return check.verification === "unverified" && check.notReached
    ? "not_reached"
    : check;
}

/**
 * The saved postings and the video's step facts as the save's write left them (its final video update, so the Continue
 * needn't read them again), or a field error per input row (its index in `postings`) and nothing saved.
 */
export type SaveVideoPostingsResult =
  | { ok: true; postings: OwnerPostingDTO[]; facts: VideoStepState }
  | { ok: false; fields: Record<number, PostingLinkError | "private"> };

/**
 * 02 §6.1's saveVideoPostings input (P11c's action parses with it too), plus the rules one field can't check: Other needs
 * its name (tidied like every typed text buyers read, owner answer Q-43 a) and no other platform takes one; Demo only
 * while mock is enabled; "I haven't posted it anywhere yet." comes with no postings; at most POSTINGS_MAX rows.
 * `sourceShowLink` is the locked Library row's own "Show buyers this link" (owner answer Q-73 a, additive to 02 §5.12 /
 * §6.1): absent leaves the source's show_link as it is.
 */
export const saveVideoPostingsInput = z
  .object({
    videoId: z.uuid(),
    notPosted: z.boolean(),
    sourceShowLink: z.boolean().optional(),
    postings: z
      .array(
        z.object({
          platform: z.enum(POSTING_PLATFORMS),
          otherLabel: tidiedText(POSTING_OTHER_LABEL_MAX).optional(),
          link: z.string().max(POSTING_URL_MAX).optional(),
          showLink: z.boolean().optional(),
        }),
      )
      .max(POSTINGS_MAX),
  })
  .superRefine((input, ctx) => {
    if (input.notPosted && input.postings.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["notPosted"],
        message: "not_posted_with_postings",
      });
    }
    const allowMock = mockEnabled();
    input.postings.forEach((posting, index) => {
      const isOther = posting.platform === "other";
      if (isOther !== (posting.otherLabel !== undefined)) {
        ctx.addIssue({
          code: "custom",
          path: ["postings", index, "otherLabel"],
          message: isOther ? "other_label_required" : "other_label_refused",
        });
      }
      if (posting.platform === "mock" && !allowMock) {
        ctx.addIssue({
          code: "custom",
          path: ["postings", index, "platform"],
          message: "mock_not_enabled",
        });
      }
    });
  });

/** saveVideoPostings' input as the step sends it, before saveVideoPostingsInput reads it. */
export type SaveVideoPostingsInput = z.input<typeof saveVideoPostingsInput>;

/** One posting as the step sends it (02 §5.12): a platform, Other's name, an optional link and the Switch. */
export type PostingInput = SaveVideoPostingsInput["postings"][number];

/** The columns of a new non-source posting, before the video, creator and position. */
export type PostingColumns = Omit<
  NewVideoPosting,
  | "id"
  | "videoId"
  | "creatorId"
  | "isSource"
  | "position"
  | "createdAt"
  | "updatedAt"
>;

/**
 * A saved non-source posting of this video, as a save finds it before replacing the rows: the prior row of the post a
 * planned row names (replacePostings' priorByPost).
 */
export type PriorPosting = Pick<
  VideoPosting,
  | "verification"
  | "unverifiedReason"
  | "socialAccountId"
  | "socialPostId"
  | "verifiedUsername"
  | "verifiedAccountLinkedAt"
  | "verifiedAt"
  | "checkedAt"
  | "showLink"
>;

/** The columns a verifying check writes: verified now, with the account and the post that verified it. */
function verifiedColumns(
  check: Extract<PostingCheckResult, { verification: "verified" }>,
  now: Date,
) {
  return {
    verification: "verified",
    unverifiedReason: null,
    socialAccountId: check.socialAccountId,
    socialPostId: check.socialPostId,
    verifiedUsername: check.verifiedUsername,
    verifiedAccountLinkedAt: check.verifiedAccountLinkedAt,
    verifiedAt: now,
    checkedAt: now,
  } as const;
}

/** A prior row's verification columns as they are, checked_at included (Q-84 a's carry-over; Q-69 a, Q-70 a's keep). */
function verificationOf(prior: PriorPosting) {
  return {
    verification: prior.verification,
    unverifiedReason: prior.unverifiedReason,
    socialAccountId: prior.socialAccountId,
    socialPostId: prior.socialPostId,
    verifiedUsername: prior.verifiedUsername,
    verifiedAccountLinkedAt: prior.verifiedAccountLinkedAt,
    verifiedAt: prior.verifiedAt,
    checkedAt: prior.checkedAt,
  };
}

/** The columns of a posting saved Not verified: its reason and no social ids. */
function unverifiedColumns(
  reason: PostingUnverifiedReason,
  checkedAt: Date | null,
) {
  return {
    verification: "unverified",
    unverifiedReason: reason,
    socialAccountId: null,
    socialPostId: null,
    verifiedUsername: null,
    verifiedAccountLinkedAt: null,
    verifiedAt: null,
    checkedAt,
  } as const;
}

/**
 * "Show buyers this link" for a saved row (owner answer Q-86 a): the input's Switch when the step sent one (the creator
 * turned it this visit); else the prior row's value when it was hidden (verified or not) or verified; else `byDefault`.
 */
function chosenShowLink(
  row: PlannedPosting,
  prior: PriorPosting | undefined,
  byDefault: boolean,
): boolean {
  if (row.showLink !== undefined) return row.showLink;
  if (prior && (!prior.showLink || prior.verification === "verified")) {
    return prior.showLink;
  }
  return byDefault;
}

/**
 * Step 6's row: the canonical url and link key, and what step 5 left (`check`), given `prior`, the saved non-source row
 * of the same post if there is one ("kept" when it is verified):
 * - verified now → verified now, with the account and the post;
 * - `carried` (Q-84 a) → the prior row's verification columns unchanged, checked_at included; its prior row gone
 *   meanwhile (a concurrent save) → as `not_reached`;
 * - a check_failed or no_account (Q-69 a, Q-70 a), or `not_reached` (Q-82 a), for a kept post → its verified fields as
 *   they were, checked now only after Q-69 a's failed check (no check ran for the other two);
 * - otherwise Not verified with its reason (`not_reached` is check_failed) and no social ids, checked now unless no
 *   check ran: none for unverifiable and no_link, the prior row's checked_at for `not_reached`.
 * show_link is chosenShowLink's (Q-86 a), whose default shows the link unless the post verified now is unlisted (07 D18).
 */
export function newPostingColumns(
  row: PlannedPosting,
  check: RowCheck,
  prior: PriorPosting | undefined,
  now: Date,
): PostingColumns {
  const link = {
    platform: row.platform,
    otherLabel: row.otherLabel,
    url: row.url,
    linkKey: row.linkKey,
  };
  const kept = prior?.verification === "verified" ? prior : undefined;
  const unlistedNow =
    typeof check !== "string" &&
    check.verification === "verified" &&
    check.visibility === "unlisted";
  const showLink = chosenShowLink(row, prior, !unlistedNow);
  if (check === "carried" && prior) {
    return { ...link, ...verificationOf(prior), showLink };
  }
  if (typeof check === "string") {
    const columns = kept
      ? verificationOf(kept)
      : unverifiedColumns("check_failed", prior?.checkedAt ?? null);
    return { ...link, ...columns, showLink };
  }
  if (check.verification === "verified") {
    return { ...link, ...verifiedColumns(check, now), showLink };
  }
  if (kept && keepsVerified(check)) {
    const checkedAt = check.reason === "check_failed" ? now : kept.checkedAt;
    return { ...link, ...verificationOf(kept), checkedAt, showLink };
  }
  const checkedAt = NOT_CHECKED.includes(check.reason) ? null : now;
  return { ...link, ...unverifiedColumns(check.reason, checkedAt), showLink };
}

/**
 * Check again's update of one posting: verified → the verified fields, verified now (and the link hidden when it just
 * became verified as an unlisted post). On a verified posting a check_failed moves only checked_at (Q-69 a), and a
 * no_account is null: no check ran, nothing to write (Q-70 a). Otherwise the verification and the reason only, so a
 * released posting keeps its social ids for audit.
 */
export function recheckColumns(
  check: PostingCheckResult,
  wasVerified: boolean,
  now: Date,
): Partial<PostingColumns> | null {
  if (check.verification === "verified") {
    // A link that turns out to be an unlisted post is hidden, as a save would hide it (07 D18); the creator can show it.
    const hidden = !wasVerified && check.visibility === "unlisted";
    return {
      ...verifiedColumns(check, now),
      ...(hidden ? { showLink: false } : {}),
    };
  }
  if (wasVerified && keepsVerified(check)) {
    return check.reason === "check_failed" ? { checkedAt: now } : null;
  }
  return {
    verification: "unverified",
    unverifiedReason: check.reason,
    checkedAt: now,
  };
}

/** Locks the creator's video for this write and checks again that its postings can change. */
async function lockEditableVideo(
  tx: Pick<typeof db, "select">,
  creatorId: string,
  videoId: string,
): Promise<void> {
  const [locked] = await tx
    .select({ status: video.status })
    .from(video)
    .where(and(eq(video.id, videoId), eq(video.creatorId, creatorId)))
    .for("update");
  if (!locked) throw new VideoNotFoundError();
  if (!POSTINGS_EDITABLE.includes(locked.status))
    throw new PostingsLockedError();
}

/**
 * Saves "Where was it posted?" (02 §5.12, 07 D69), in this order:
 * 1. the input (saveVideoPostingsInput; a ZodError when it fails), a creator actor, the creator's own video (else
 *    VideoNotFoundError), `draft` or `unpublished` (else PostingsLockedError), `notPosted` only on an upload (else
 *    InvalidPostingsError('not_posted_library')), something chosen on a video with no source posting (rows or
 *    `notPosted`, else 'nothing_chosen'), the source posting plus the rows ≤ POSTINGS_MAX (else 'too_many');
 * 2–3. planPostings: each link read again; any that doesn't read → `{ ok: false, fields }`, no call and no write;
 * 4. the cross-creator rule for every row with a link key, verified or not (AlreadyLicensableElsewhereError,
 *    AlreadyOnYourVideoError, each with the refused row's input `index`: Q-78 a), before any platform call;
 * 5. checkRow for each row, one at a time, outside any transaction, all under one deadline of
 *    POSTING_CHECKS_BUDGET_MS (postingDeadline, Q-82 a): a post whose saved check still stands is carried over with no call (Q-84 a,
 *    checkedRecently); a post verified here through an account that isn't connected now is not checked (Q-70 a); a row
 *    the deadline stopped before any platform call is not_reached (check_failed, no call, no checked_at); any other goes
 *    to verifyPostingLink.
 *    A private post → `fields[index] = 'private'`, and nothing is written;
 * 6. one transaction: the video locked and checked again, the cross-creator rule again, the non-source rows replaced at
 *    positions 1…n in input order (newPostingColumns, each with the saved row of its post), auditNewlyVerified (a
 *    `video_posting.conflict` audit per posting that became verified while other creators hold it unverified),
 *    refreshVideoOwnership, postings_confirmed_at now (also with no rows), the same-video tick cleared only when the set
 *    of verified posts changed, and audit `video.postings_saved { platforms, verified }` (platforms in position order,
 *    the source's included). A lost video_posting_verified_uidx → AlreadyOnYourVideoError when the creator's own other
 *    video won, else AlreadyLicensableElsewhereError (verifiedPostingConflictError). `sourceShowLink`, when given, sets
 *    the source row's show_link in the same transaction (Q-73 a);
 * 7. the postings as the owner's DTOs, and the step facts the final video update returned.
 */
export async function saveVideoPostings(
  a: Actor,
  i: SaveVideoPostingsInput,
): Promise<SaveVideoPostingsResult> {
  // 1.
  const input = saveVideoPostingsInput.parse(i);
  const actor = requireCreatorActor(a);
  const [current] = await db
    .select({
      status: video.status,
      source: video.source,
      sourcePlatform: videoPosting.platform,
      sourceLinkKey: videoPosting.linkKey,
    })
    .from(video)
    .leftJoin(
      videoPosting,
      and(eq(videoPosting.videoId, video.id), eq(videoPosting.isSource, true)),
    )
    .where(
      and(eq(video.id, input.videoId), eq(video.creatorId, actor.creatorId)),
    );
  if (!current) throw new VideoNotFoundError();
  if (!POSTINGS_EDITABLE.includes(current.status))
    throw new PostingsLockedError();
  if (input.notPosted && current.source === "library") {
    throw new InvalidPostingsError("not_posted_library");
  }
  const source =
    current.sourcePlatform === null
      ? null
      : { platform: current.sourcePlatform, linkKey: current.sourceLinkKey };
  if (!source && !input.notPosted && input.postings.length === 0) {
    throw new InvalidPostingsError("nothing_chosen");
  }
  if ((source ? 1 : 0) + input.postings.length > POSTINGS_MAX) {
    throw new InvalidPostingsError("too_many");
  }

  // 2 and 3.
  const plan = planPostings(input.postings, {
    allowMock: mockEnabled(),
    source,
  });
  if (!plan.ok) return plan;

  // 4. Each target carries its row's input index, so a refusal names the field it belongs to (Q-78 a).
  const targets: PostingTarget[] = plan.rows.flatMap((row) =>
    row.linkKey === null
      ? []
      : [
          {
            creatorId: actor.creatorId,
            videoId: input.videoId,
            platform: row.platform,
            linkKey: row.linkKey,
            index: row.index,
          },
        ],
  );
  await assertPostingsAvailable(db, targets);

  // 5.
  const checked: { row: PlannedPosting; check: RowCheck }[] = [];
  const fields: Record<number, "private"> = {};
  const saved = await savedCheckFlags(input.videoId);
  const deadline = postingDeadline();
  for (const row of plan.rows) {
    try {
      checked.push({
        row,
        check: await checkRow(actor.creatorId, row, saved, deadline),
      });
    } catch (error) {
      if (!(error instanceof NotPublicError)) throw error;
      fields[row.index] = "private";
    }
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };

  // 6.
  let facts: VideoStepState;
  try {
    facts = await db.transaction(async (tx) => {
      await lockEditableVideo(tx, actor.creatorId, input.videoId);
      await assertPostingsAvailable(tx, targets);
      return replacePostings(tx, actor, input.videoId, {
        checked,
        sourceShowLink: input.sourceShowLink,
      });
    });
  } catch (error) {
    throw await verifiedPostingConflictError(db, error, targets);
  }

  // 7.
  return {
    ok: true,
    postings: await listVideoPostings(actor, input.videoId),
    facts,
  };
}

/**
 * A posting's post as replacePostings' priorByPost keys it (Q-86 a): `platform:link_key`, else (an Other link) its
 * platform and canonical url; null for a row with no link.
 */
function priorKey(posting: {
  platform: PostingPlatform;
  linkKey: string | null;
  url: string | null;
}): string | null {
  if (posting.linkKey !== null)
    return postKey(posting.platform, posting.linkKey);
  return posting.url === null ? null : `${posting.platform} ${posting.url}`;
}

/**
 * saveVideoPostings' write, inside its transaction with the video locked: the non-source rows replaced at positions
 * 1…n, each written with the saved non-source row of its post (priorByPost: what Q-69 a and Q-70 a keep, Q-84 a carries
 * over and Q-86 a's Switch follows), the source row's show_link when `sourceShowLink` is given (Q-73 a: nothing else on
 * it changes; an upload has no source row), auditNewlyVerified, refreshVideoOwnership, postings_confirmed_at, the
 * same-video tick and `video.postings_saved`. Returns the step facts as the final video update left them.
 */
async function replacePostings(
  tx: Pick<typeof db, "select" | "insert" | "update" | "delete">,
  actor: CreatorActor,
  videoId: string,
  {
    checked,
    sourceShowLink,
  }: {
    checked: readonly { row: PlannedPosting; check: RowCheck }[];
    sourceShowLink: boolean | undefined;
  },
): Promise<VideoStepState> {
  const now = new Date();
  const before = await tx
    .select({
      isSource: videoPosting.isSource,
      platform: videoPosting.platform,
      linkKey: videoPosting.linkKey,
      url: videoPosting.url,
      verification: videoPosting.verification,
      unverifiedReason: videoPosting.unverifiedReason,
      socialAccountId: videoPosting.socialAccountId,
      socialPostId: videoPosting.socialPostId,
      verifiedUsername: videoPosting.verifiedUsername,
      verifiedAccountLinkedAt: videoPosting.verifiedAccountLinkedAt,
      verifiedAt: videoPosting.verifiedAt,
      checkedAt: videoPosting.checkedAt,
      showLink: videoPosting.showLink,
    })
    .from(videoPosting)
    .where(eq(videoPosting.videoId, videoId));
  const priorByPost = new Map(
    before.flatMap((posting) => {
      const key = posting.isSource ? null : priorKey(posting);
      return key === null ? [] : [[key, posting] as const];
    }),
  );
  await tx
    .delete(videoPosting)
    .where(
      and(eq(videoPosting.videoId, videoId), eq(videoPosting.isSource, false)),
    );
  // Positions 1…n in input order, so the source row and these are the video's postings in position order.
  const rows = checked.map(({ row, check }, n) => {
    const key = priorKey(row);
    return {
      ...newPostingColumns(
        row,
        check,
        key === null ? undefined : priorByPost.get(key),
        now,
      ),
      videoId,
      creatorId: actor.creatorId,
      isSource: false,
      position: n + 1,
    };
  });
  if (rows.length > 0) await tx.insert(videoPosting).values(rows);
  if (sourceShowLink !== undefined && before.some((p) => p.isSource)) {
    await tx
      .update(videoPosting)
      .set({ showLink: sourceShowLink })
      .where(
        and(eq(videoPosting.videoId, videoId), eq(videoPosting.isSource, true)),
      );
  }
  // 07 D68: an audit when a posting becomes verified; one this video already had verified (kept or re-saved) isn't new.
  const changed = await auditNewlyVerified(
    tx,
    actor,
    videoId,
    verifiedKeys(before),
  );
  await refreshVideoOwnership(tx, videoId);
  const [facts] = await tx
    .update(video)
    .set({
      postingsConfirmedAt: now,
      ...(changed ? { sameVideoConfirmedAt: null } : {}),
    })
    .where(eq(video.id, videoId))
    .returning(stepFactColumns);
  if (!facts) throw new Error("saveVideoPostings: the locked video is gone");
  // The audit reads platforms and verification only, so the source row's show_link as read before is fine here.
  const after = [...before.filter((posting) => posting.isSource), ...rows];
  await writeAudit(tx, actor, {
    action: "video.postings_saved",
    entityType: "video",
    entityId: videoId,
    data: {
      platforms: after.map((posting) => posting.platform),
      verified: after.filter((posting) => posting.verification === "verified")
        .length,
    },
  });
  return stepFactsOf(facts);
}

/**
 * Check again (02 §5.12, 07 D66): one posting checked again by id, in this order:
 * 1. the posting through its video (`video.creator_id` = the creator's, else VideoNotFoundError, as for an id that isn't
 *    a uuid), the video `draft` or `unpublished` (else PostingsLockedError), and its checkFlags. A posting with no link
 *    key, or on a platform that can't be verified, comes back unchanged with no call;
 * 2. the cross-creator rule: a released posting another creator verified meanwhile → AlreadyLicensableElsewhereError;
 *    then its last check standing (checkedRecently: within POSTING_CHECK_COOLDOWN_MS, no account (re)connected or
 *    synced since) → CheckedRecentlyError, with no call (Q-84 a);
 * 3. checkPosting outside any transaction, under its own deadline of POSTING_CHECKS_BUDGET_MS (Q-82 a: the
 *    deadline cutting the call is check_failed); none for a posting verified through an account that isn't connected
 *    now, the source posting included (Q-70 a). NotPublicError is thrown and nothing is written;
 * 4. one transaction: the video locked, its status and the cross-creator rule checked again, then that posting only
 *    (recheckColumns: checked_at now, or nothing written when no check ran), auditNewlyVerified (a
 *    `video_posting.conflict` audit when it became verified), refreshVideoOwnership, and the same-video tick
 *    cleared when it became or stopped being verified. A lost video_posting_verified_uidx → AlreadyOnYourVideoError or
 *    AlreadyLicensableElsewhereError, as for a save. The source posting can be checked again this way (released, after
 *    an Enable);
 * 5. the posting as the owner's DTO (getOwnerPosting; gone meanwhile → VideoNotFoundError).
 */
export async function recheckPosting(
  a: Actor,
  i: { postingId: string },
): Promise<OwnerPostingDTO> {
  // 1.
  const actor = requireCreatorActor(a);
  if (!isUuid(i.postingId)) throw new VideoNotFoundError();
  const [posting] = await db
    .select({
      id: videoPosting.id,
      videoId: videoPosting.videoId,
      platform: videoPosting.platform,
      linkKey: videoPosting.linkKey,
      url: videoPosting.url,
      status: video.status,
      ...checkFlags,
    })
    .from(videoPosting)
    .innerJoin(video, eq(video.id, videoPosting.videoId))
    .leftJoin(socialAccount, eq(socialAccount.id, videoPosting.socialAccountId))
    .where(
      and(
        eq(videoPosting.id, i.postingId),
        eq(video.creatorId, actor.creatorId),
      ),
    );
  if (!posting) throw new VideoNotFoundError();
  if (!POSTINGS_EDITABLE.includes(posting.status))
    throw new PostingsLockedError();
  const { linkKey, platform } = posting;
  if (linkKey !== null && isOneOf(VERIFIABLE_POSTING_PLATFORMS, platform)) {
    await checkAgain(actor, { ...posting, linkKey });
  }
  return getOwnerPosting(actor, posting.id);
}

/** recheckPosting's steps 2–4 for a posting with a link key on a platform that can be verified. */
async function checkAgain(
  actor: CreatorActor,
  posting: CheckFlags & {
    id: string;
    videoId: string;
    platform: PostingPlatform;
    linkKey: string;
    url: string | null;
  },
): Promise<void> {
  // 2.
  const target: PostingTarget = {
    creatorId: actor.creatorId,
    videoId: posting.videoId,
    platform: posting.platform,
    linkKey: posting.linkKey,
  };
  await assertPostingAvailable(db, target);
  if (posting.recent) throw new CheckedRecentlyError();

  // 3. A posting verified through an account that isn't connected now, the source posting too, keeps its fields and its
  // checked_at: no call (Q-70 a).
  const check = await checkPosting(
    actor.creatorId,
    posting,
    posting.unlinked,
    postingDeadline(),
  );

  // 4.
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await lockEditableVideo(tx, actor.creatorId, posting.videoId);
      await assertPostingAvailable(tx, target);
      const postings = await tx
        .select({
          id: videoPosting.id,
          platform: videoPosting.platform,
          linkKey: videoPosting.linkKey,
          verification: videoPosting.verification,
        })
        .from(videoPosting)
        .where(eq(videoPosting.videoId, posting.videoId));
      const row = postings.find((p) => p.id === posting.id);
      // A save replaced the video's postings meanwhile: this one is gone.
      if (!row) throw new VideoNotFoundError();
      const columns = recheckColumns(
        check,
        row.verification === "verified",
        now,
      );
      if (columns) {
        await tx
          .update(videoPosting)
          .set(columns)
          .where(eq(videoPosting.id, posting.id));
      }
      // video_posting_video_link_uidx: no other posting of this video names this post, so the verified set changes
      // exactly when this posting became or stopped being verified.
      const changed = await auditNewlyVerified(
        tx,
        actor,
        posting.videoId,
        verifiedKeys(postings),
      );
      await refreshVideoOwnership(tx, posting.videoId);
      if (changed) {
        await tx
          .update(video)
          .set({ sameVideoConfirmedAt: null })
          .where(eq(video.id, posting.videoId));
      }
    });
  } catch (error) {
    throw await verifiedPostingConflictError(db, error, [target]);
  }
}
