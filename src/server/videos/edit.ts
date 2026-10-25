import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { video } from "../../db/schema";
import type { VideoStatus } from "../../lib/domain/values";
import { POSTINGS_EDITABLE } from "../../lib/postings/form";
import { isUuid } from "../../lib/validation/uuid";
import { videoDetailsSchema } from "../../lib/validation/video";
import { MUSIC_DISABLED_USES, rightsLockOf } from "../../lib/videos/rights";
import { type Actor, requireCreatorActor } from "../auth/actor";
import { uniqueViolationConstraint } from "../db-errors";
import { PostingsLockedError } from "../postings/errors";
import { lockFlags } from "../storage/uploads";
import {
  NoVerifiedPostingError,
  OriginalNotReadyError,
  RightsLockedError,
  SlugLockedError,
  SlugTakenError,
  VideoDisabledError,
  VideoNotFoundError,
} from "./errors";

// A video's edits that aren't uploads or postings (02 §5.6), each under the video row lock: "These posts show this same
// video" on the Where posted step (07 D69; P11c moved it there from P11's File step), stored and taken back only while
// the postings can change (POSTINGS_EDITABLE: `draft` or `unpublished`, as for saveVideoPostings); the Rights step's
// answers (attestRights); and the Review's title and link (updateVideoDetails).

/**
 * Locks the creator's video row (FOR UPDATE) and reads what the tick's writes check. Refusals: VideoNotFoundError (not
 * the creator's, or missing), PostingsLockedError (not `draft` or `unpublished`).
 */
async function lockForTick(
  tx: Pick<typeof db, "select">,
  creatorId: string,
  videoId: string,
) {
  const [row] = await tx
    .select({
      status: video.status,
      ownership: video.ownership,
      originalStatus: video.originalStatus,
      sameVideoConfirmedAt: video.sameVideoConfirmedAt,
    })
    .from(video)
    .where(and(eq(video.id, videoId), eq(video.creatorId, creatorId)))
    .for("update");
  if (!row) throw new VideoNotFoundError();
  if (!POSTINGS_EDITABLE.includes(row.status)) throw new PostingsLockedError();
  return row;
}

/**
 * Stores the tick: the owner's `draft` or `unpublished` video with a `ready` original and at least one verified posting,
 * any source, gets `same_video_confirmed_at`, once. Confirming again keeps the first time and writes nothing. Refusals,
 * in this order: VideoNotFoundError, PostingsLockedError, NoVerifiedPostingError, OriginalNotReadyError. "A verified
 * posting" is the locked row's `ownership = 'verified_owner'` (07 D66): every posting write refreshes it
 * (refreshVideoOwnership) under this same video lock, so a save or Check again that changes the verified set (and
 * clears the tick, D69) is either seen whole or waits.
 */
export async function confirmSameVideo(
  a: Actor,
  videoId: string,
): Promise<void> {
  const { creatorId } = requireCreatorActor(a);
  if (!isUuid(videoId)) throw new VideoNotFoundError();
  await db.transaction(async (tx) => {
    const row = await lockForTick(tx, creatorId, videoId);
    if (row.ownership !== "verified_owner") throw new NoVerifiedPostingError();
    if (row.originalStatus !== "ready") throw new OriginalNotReadyError();
    if (row.sameVideoConfirmedAt) return;
    await tx
      .update(video)
      .set({ sameVideoConfirmedAt: new Date() })
      .where(eq(video.id, videoId));
  });
}

/**
 * Takes the tick back (owner answer Q-83 a: the creator unticked a stored "These posts show this same video" and pressed
 * Continue): `same_video_confirmed_at` cleared, a no-op when it is already clear. Refusals, in this order:
 * VideoNotFoundError, PostingsLockedError.
 */
export async function withdrawSameVideo(
  a: Actor,
  videoId: string,
): Promise<void> {
  const { creatorId } = requireCreatorActor(a);
  if (!isUuid(videoId)) throw new VideoNotFoundError();
  await db.transaction(async (tx) => {
    const row = await lockForTick(tx, creatorId, videoId);
    if (row.sameVideoConfirmedAt === null) return;
    await tx
      .update(video)
      .set({ sameVideoConfirmedAt: null })
      .where(eq(video.id, videoId));
  });
}

/**
 * Locks the creator's video row (FOR UPDATE) for the Rights and Review edits. Refusals, in this order:
 * VideoNotFoundError (not the creator's, or missing), VideoDisabledError. What lives in other tables (lockFlags) is read
 * after this, in a statement of its own: one that waited for the lock still sees them as they were when it began (READ
 * COMMITTED), before the transaction it waited for committed its rows.
 */
async function lockEditableVideo(
  tx: Pick<typeof db, "select">,
  creatorId: string,
  videoId: string,
) {
  const [row] = await tx
    .select({
      status: video.status,
      slug: video.slug,
      publishedAt: video.publishedAt,
    })
    .from(video)
    .where(and(eq(video.id, videoId), eq(video.creatorId, creatorId)))
    .for("update");
  if (!row) throw new VideoNotFoundError();
  if (row.status === "disabled") throw new VideoDisabledError();
  return row;
}

/**
 * The Rights step's answers (02 §5.6, 07 D39, D82; research/license.md §7): `contains_music`, `identifiable_people`,
 * `rights_attested_at = now()`, `attestation_version = 'v1'`, and `disabled_uses` = paid_social and broadcast when music
 * is Yes, else none (P19d lets the creator turn either back on). Re-attesting overwrites all of it. Under the video row
 * lock, so it serializes with approve's lockVideoForLicensing (07 D110). Refusals, in this order: VideoNotFoundError,
 * VideoDisabledError, RightsLockedError('license') once a license exists, RightsLockedError('request') while a request is
 * checkout_pending or awaiting_approval (owner answer Q-96 a). Returns the video's status: a draft goes on to Review, a
 * video past its draft back to its page (P14b).
 */
export async function attestRights(
  a: Actor,
  i: {
    videoId: string;
    ownsRights: true;
    containsMusic: boolean;
    identifiablePeople: boolean;
  },
): Promise<VideoStatus> {
  const { creatorId } = requireCreatorActor(a);
  if (!isUuid(i.videoId)) throw new VideoNotFoundError();
  return db.transaction(async (tx) => {
    const { status } = await lockEditableVideo(tx, creatorId, i.videoId);
    const [flags] = await tx
      .select(lockFlags(tx))
      .from(video)
      .where(eq(video.id, i.videoId));
    const lock = flags ? rightsLockOf(flags) : null;
    if (lock) throw new RightsLockedError(lock);
    await tx
      .update(video)
      .set({
        containsMusic: i.containsMusic,
        identifiablePeople: i.identifiablePeople,
        rightsAttestedAt: new Date(),
        attestationVersion: "v1",
        disabledUses: i.containsMusic ? [...MUSIC_DISABLED_USES] : [],
      })
      .where(eq(video.id, i.videoId));
    return status;
  });
}

/**
 * The Review's Title and Link rows (02 §5.6, 07 D09, D23): the fields given, re-parsed here (videoDetailsSchema: the
 * title tidied, the slug trimmed and lowercased, owner answer Q-98); a field left out keeps its stored value. An edited
 * slug is never suffixed: one another of the creator's videos uses is refused by video_creator_slug_uidx. Refusals, in
 * this order: VideoNotFoundError, VideoDisabledError, SlugLockedError (a new slug once `published_at` is set),
 * SlugTakenError. A ZodError for input that doesn't parse.
 */
export async function updateVideoDetails(
  a: Actor,
  input: { videoId: string; title?: string; slug?: string },
): Promise<void> {
  const { creatorId } = requireCreatorActor(a);
  if (!isUuid(input.videoId)) throw new VideoNotFoundError();
  const { videoId, title, slug } = videoDetailsSchema.parse(input);
  try {
    await db.transaction(async (tx) => {
      const row = await lockEditableVideo(tx, creatorId, videoId);
      if (slug !== undefined && slug !== row.slug && row.publishedAt) {
        throw new SlugLockedError();
      }
      await tx.update(video).set({ title, slug }).where(eq(video.id, videoId));
    });
  } catch (error) {
    // Another of the creator's videos has the slug.
    if (uniqueViolationConstraint(error) === "video_creator_slug_uidx") {
      throw new SlugTakenError();
    }
    throw error;
  }
}
