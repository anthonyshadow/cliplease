import "server-only";
import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { db } from "../../db/client";
import { socialAccount, video, videoPosting } from "../../db/schema";
import type { Ownership, PostingPlatform } from "../../lib/domain/values";
import { writeAudit } from "../audit";
import type { Actor } from "../auth/actor";
import { uniqueViolationConstraint } from "../db-errors";
import {
  AlreadyLicensableElsewhereError,
  AlreadyOnYourVideoError,
} from "./errors";

// A video's ownership and the cross-creator guards on its postings (02 §5.12, 03 §7.4, I27, I28; 07 D66, D68). Each
// takes db or a transaction; every posting write calls auditNewlyVerified, then refreshVideoOwnership, in the
// transaction that wrote it.

/** One verified posting per platform post, across all creators and videos (I27). */
const VERIFIED_POSTING_INDEX = "video_posting_verified_uidx";

/** A platform post as one string: `platform:link_key`. */
export function postKey(platform: PostingPlatform, linkKey: string): string {
  return `${platform}:${linkKey}`;
}

/** The verified platform posts among `postings`, as `platform:link_key` strings. */
export function verifiedKeys(
  postings: readonly {
    platform: PostingPlatform;
    linkKey: string | null;
    verification: string;
  }[],
): Set<string> {
  const keys = new Set<string>();
  for (const posting of postings) {
    if (posting.verification === "verified" && posting.linkKey !== null) {
      keys.add(postKey(posting.platform, posting.linkKey));
    }
  }
  return keys;
}

function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((key) => b.has(key));
}

/**
 * video.ownership from the video's postings (07 D66): `verified_owner` iff at least one posting is verified, else
 * `self_attested`. One statement, so it reads the postings as the calling transaction left them. Returns the new value.
 */
export async function refreshVideoOwnership(
  exec: Pick<typeof db, "update">,
  videoId: string,
): Promise<Ownership> {
  const [row] = await exec
    .update(video)
    .set({
      ownership: sql`case when exists (
        select 1 from ${videoPosting}
        where ${videoPosting.videoId} = ${video.id} and ${videoPosting.verification} = 'verified'
      ) then 'verified_owner'::video_ownership else 'self_attested'::video_ownership end`,
    })
    .where(eq(video.id, videoId))
    .returning({ ownership: video.ownership });
  if (!row) throw new Error("refreshVideoOwnership: no such video");
  return row.ownership;
}

/**
 * A pasted link's platform post as the cross-creator rule checks it for one creator's video (07 D68). `index` is the
 * row's index in a save's input, carried by the refusal (owner answer Q-78 a); Check again's target has none.
 */
export type PostingTarget = {
  creatorId: string;
  videoId: string;
  platform: PostingPlatform;
  linkKey: string;
  index?: number;
};

/**
 * The cross-creator rule for a pasted link (03 §7.4 "verified elsewhere", video_posting_verified_uidx; 07 D68), run
 * for every posting with a link key whether or not it would verify: verified on another creator's video →
 * AlreadyLicensableElsewhereError; on this creator's other video → AlreadyOnYourVideoError with that video's title.
 * Either carries the target's `index`. Held by this video, or by nobody: returns.
 */
export function assertPostingAvailable(
  exec: Pick<typeof db, "select">,
  target: PostingTarget,
): Promise<void> {
  return assertPostingsAvailable(exec, [target]);
}

/**
 * Of `accountIds`, the ones still `connected`, each held FOR SHARE until the transaction ends (03 §9.3): a Disconnect
 * that committed first is seen here, and one that comes later waits for this write, then spares the posts it
 * references. Taken after the video's lock (video → account → post, the order sync and Disconnect also keep from the
 * account on).
 */
export async function lockConnectedAccounts(
  tx: Pick<typeof db, "select">,
  accountIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (accountIds.length === 0) return new Set();
  const rows = await tx
    .select({ id: socialAccount.id })
    .from(socialAccount)
    .where(
      and(
        inArray(socialAccount.id, [...accountIds]),
        eq(socialAccount.status, "connected"),
      ),
    )
    .for("share");
  return new Set(rows.map((row) => row.id));
}

/**
 * assertPostingAvailable for many targets with one read of their verified holders (the index allows one per platform
 * post), then the targets in order, the first refusal thrown. No targets: no read.
 */
export async function assertPostingsAvailable(
  exec: Pick<typeof db, "select">,
  targets: readonly PostingTarget[],
): Promise<void> {
  if (targets.length === 0) return;
  const holders = await exec
    .select({
      videoId: videoPosting.videoId,
      creatorId: videoPosting.creatorId,
      title: video.title,
      platform: videoPosting.platform,
      linkKey: videoPosting.linkKey,
    })
    .from(videoPosting)
    .innerJoin(video, eq(video.id, videoPosting.videoId))
    .where(
      and(
        eq(videoPosting.verification, "verified"),
        or(
          ...targets.map((target) =>
            and(
              eq(videoPosting.platform, target.platform),
              eq(videoPosting.linkKey, target.linkKey),
            ),
          ),
        ),
      ),
    );
  for (const target of targets) {
    const holder = holders.find(
      (h) => h.platform === target.platform && h.linkKey === target.linkKey,
    );
    if (!holder) continue;
    if (holder.creatorId !== target.creatorId) {
      throw new AlreadyLicensableElsewhereError(target.index);
    }
    if (holder.videoId !== target.videoId) {
      throw new AlreadyOnYourVideoError(holder.title, target.index);
    }
  }
}

/**
 * After posting `videoPostingId` became verified: other creators' unverified postings of the same platform post
 * (03 §7.4 "unverified holders", video_posting_link_idx) → one `video_posting.conflict` audit for admin Events
 * (07 D68), by id only (no link, no link key). Nothing else changes; none → no audit.
 */
export async function auditPostingConflicts(
  tx: Pick<typeof db, "select" | "insert">,
  actor: Actor,
  i: {
    videoPostingId: string;
    creatorId: string;
    platform: PostingPlatform;
    linkKey: string;
  },
): Promise<void> {
  const holders = await tx
    .select({ id: videoPosting.id })
    .from(videoPosting)
    .where(
      and(
        eq(videoPosting.platform, i.platform),
        eq(videoPosting.linkKey, i.linkKey),
        eq(videoPosting.verification, "unverified"),
        ne(videoPosting.creatorId, i.creatorId),
      ),
    )
    .orderBy(videoPosting.id);
  if (holders.length === 0) return;
  await writeAudit(tx, actor, {
    action: "video_posting.conflict",
    entityType: "video_posting",
    entityId: i.videoPostingId,
    data: {
      videoPostingId: i.videoPostingId,
      platform: i.platform,
      conflictingPostingIds: holders.map((h) => h.id),
    },
  });
}

/**
 * After a posting write, in its transaction and before refreshVideoOwnership (07 D66, D68): auditPostingConflicts for
 * each of the video's verified postings, in position order, whose platform post isn't in `verifiedBefore` (07 D68: on
 * becoming verified only; the posting's creator is the video's, video_posting_video_fk). Returns whether the video's
 * set of verified posts changed (the same-video tick is cleared then).
 */
export async function auditNewlyVerified(
  tx: Pick<typeof db, "select" | "insert">,
  actor: Actor,
  videoId: string,
  verifiedBefore: ReadonlySet<string>,
): Promise<boolean> {
  const verified = await tx
    .select({
      id: videoPosting.id,
      creatorId: videoPosting.creatorId,
      platform: videoPosting.platform,
      linkKey: videoPosting.linkKey,
      verification: videoPosting.verification,
    })
    .from(videoPosting)
    .where(
      and(
        eq(videoPosting.videoId, videoId),
        eq(videoPosting.verification, "verified"),
      ),
    )
    .orderBy(asc(videoPosting.position));
  for (const posting of verified) {
    if (
      posting.linkKey !== null &&
      !verifiedBefore.has(postKey(posting.platform, posting.linkKey))
    ) {
      await auditPostingConflicts(tx, actor, {
        videoPostingId: posting.id,
        creatorId: posting.creatorId,
        platform: posting.platform,
        linkKey: posting.linkKey,
      });
    }
  }
  return !sameKeys(verifiedBefore, verifiedKeys(verified));
}

/** Whether a failed posting write lost video_posting_verified_uidx (23505): another posting holds it verified. */
export function isVerifiedPostingConflict(error: unknown): boolean {
  return uniqueViolationConstraint(error) === VERIFIED_POSTING_INDEX;
}

/**
 * What a failed posting write throws (07 D66): anything but a lost video_posting_verified_uidx is `error` as it is. A
 * lost index names no row, so the cross-creator rule runs again for `targets`: it throws AlreadyOnYourVideoError when
 * the creator's own other video won the race, or AlreadyLicensableElsewhereError, each with the refused target's
 * `index`; when it passes, the result is AlreadyLicensableElsewhereError with no index.
 * `catch (e) { throw await verifiedPostingConflictError(db, e, targets); }`.
 */
export async function verifiedPostingConflictError(
  exec: Pick<typeof db, "select">,
  error: unknown,
  targets: readonly PostingTarget[],
): Promise<unknown> {
  if (!isVerifiedPostingConflict(error)) return error;
  await assertPostingsAvailable(exec, targets);
  return new AlreadyLicensableElsewhereError();
}
