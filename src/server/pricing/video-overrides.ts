import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { creatorProfile, video } from "@/db/schema";
import {
  type RateOptionKey,
  USE_KEYS,
  type VideoExclusiveMode,
} from "@/lib/domain/values";
import { exclusiveColumnsOf, exclusiveModeOf } from "@/lib/pricing/exclusive";
import {
  VideoExclusiveOfferInputSchema,
  VideoUseToggleInputSchema,
  videoBasePriceInputSchema,
} from "@/lib/validation/pricing";
import { isUuid } from "@/lib/validation/uuid";
import { MUSIC_DISABLED_USES, type MusicUseKey } from "@/lib/videos/rights";
import { type AuditExecutor, writeAudit } from "../audit";
import { type Actor, requireCreatorActor } from "../auth/actor";
import { lockEditableVideo } from "../videos/edit";
import { NoMusicError, VideoNotFoundError } from "../videos/errors";

// Per-video price and music re-enable (02 §5.5; 07 D82), and the exclusive offer (07 D109): the creator's own video, under
// its row lock (lockEditableVideo, whose refusals come first: VideoNotFoundError, then VideoDisabledError), compared,
// written and audited in one transaction; the same value again writes nothing. New requests only: no license_request is
// read or written, and pending requests keep their snapshot. edit.ts imports auditMusicUseChanges from here and this file
// imports its lock: a cycle that is safe because neither uses an imported binding while it loads.

/**
 * Audits each music use whose state differs between `before` and `after` (`video.use_toggled { useKey, enabled }`), in
 * the caller's transaction: the video page's Switches, and a Rights re-attest on a video already stored music Yes.
 */
export async function auditMusicUseChanges(
  tx: AuditExecutor,
  a: Actor,
  videoId: string,
  before: readonly RateOptionKey[],
  after: readonly RateOptionKey[],
): Promise<void> {
  for (const useKey of MUSIC_DISABLED_USES) {
    const isOff = after.includes(useKey);
    if (before.includes(useKey) === isOff) continue;
    await writeAudit(tx, a, {
      action: "video.use_toggled",
      entityType: "video",
      entityId: videoId,
      data: { useKey, enabled: !isOff },
    });
  }
}

/**
 * The video's own base price, or null for the rate card's (07 D82, D97): whole dollars within the rate card's bounds in
 * the creator's payout currency (a ZodError for anything else). Audited `video.price_set { fromCents, toCents, currency }`
 * when it changes. Refusals: VideoNotFoundError, VideoDisabledError.
 */
export async function setVideoBasePrice(
  a: Actor,
  i: { videoId: string; basePriceCents: number | null },
): Promise<void> {
  const { creatorId } = requireCreatorActor(a);
  if (!isUuid(i.videoId)) throw new VideoNotFoundError();
  await db.transaction(async (tx) => {
    const row = await lockEditableVideo(tx, creatorId, i.videoId);
    const [profile] = await tx
      .select({ currency: creatorProfile.payoutCurrency })
      .from(creatorProfile)
      .where(eq(creatorProfile.id, creatorId));
    if (!profile) throw new Error(`Creator ${creatorId} has no profile`);
    const { basePriceCents } = videoBasePriceInputSchema(
      profile.currency,
    ).parse(i);
    if (basePriceCents === row.basePriceOverrideCents) return;
    await tx
      .update(video)
      .set({ basePriceOverrideCents: basePriceCents })
      .where(eq(video.id, i.videoId));
    await writeAudit(tx, a, {
      action: "video.price_set",
      entityType: "video",
      entityId: i.videoId,
      data: {
        fromCents: row.basePriceOverrideCents,
        toCents: basePriceCents,
        currency: profile.currency,
      },
    });
  });
}

/**
 * Turns one music use back on, or off again, for a video with music (07 D82; 01 J5.14): `disabled_uses` keeps USE_KEYS'
 * order. Audited `video.use_toggled` when it changes. It isn't locked by licenses or waiting requests: the Rights answers
 * lock, this Switch doesn't. Refusals: VideoNotFoundError, VideoDisabledError, NoMusicError (the music answer isn't Yes).
 */
export async function setVideoUseEnabled(
  a: Actor,
  i: { videoId: string; useKey: MusicUseKey; enabled: boolean },
): Promise<void> {
  const { creatorId } = requireCreatorActor(a);
  if (!isUuid(i.videoId)) throw new VideoNotFoundError();
  const { useKey, enabled } = VideoUseToggleInputSchema.parse(i);
  await db.transaction(async (tx) => {
    const row = await lockEditableVideo(tx, creatorId, i.videoId);
    if (row.containsMusic !== true) throw new NoMusicError();
    if (row.disabledUses.includes(useKey) === !enabled) return;
    const off = USE_KEYS.filter((key) =>
      key === useKey ? !enabled : row.disabledUses.includes(key),
    );
    await tx
      .update(video)
      .set({ disabledUses: off })
      .where(eq(video.id, i.videoId));
    await auditMusicUseChanges(tx, a, i.videoId, row.disabledUses, off);
  });
}

/**
 * The video's own exclusive offer (07 D109, D127): 'rate_card' follows the card, 'on' offers it here (a null premium is
 * the card's), 'off' doesn't (exclusiveColumnsOf). Audited `video.exclusive_set { fromMode, fromMultiplierBps, toMode,
 * toMultiplierBps }` when it changes. New requests only: no request or license is read or written, and neither blocks it
 * (J12.13). A ZodError for crafted input. Refusals: VideoNotFoundError, VideoDisabledError.
 */
export async function setVideoExclusiveOffer(
  a: Actor,
  i: {
    videoId: string;
    mode: VideoExclusiveMode;
    multiplierBps: number | null;
  },
): Promise<void> {
  const { creatorId } = requireCreatorActor(a);
  if (!isUuid(i.videoId)) throw new VideoNotFoundError();
  const { mode, multiplierBps } = VideoExclusiveOfferInputSchema.parse(i);
  const to = exclusiveColumnsOf(mode, multiplierBps);
  await db.transaction(async (tx) => {
    const row = await lockEditableVideo(tx, creatorId, i.videoId);
    if (
      row.exclusiveEnabled === to.exclusiveEnabled &&
      row.exclusiveMultiplierBps === to.exclusiveMultiplierBps
    ) {
      return;
    }
    await tx.update(video).set(to).where(eq(video.id, i.videoId));
    await writeAudit(tx, a, {
      action: "video.exclusive_set",
      entityType: "video",
      entityId: i.videoId,
      data: {
        fromMode: exclusiveModeOf(row.exclusiveEnabled),
        fromMultiplierBps: row.exclusiveMultiplierBps,
        toMode: mode,
        toMultiplierBps: to.exclusiveMultiplierBps,
      },
    });
  });
}
