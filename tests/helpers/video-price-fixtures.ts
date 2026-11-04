// The per-video price tests' shared music video and audit reads (P19d; 07 D82) and the exclusive offer's audits (P19e;
// 07 D109): video-price.test.ts, video-price-actions.test.ts and exclusive-pricing.test.ts. Tests only.
import { asc, eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { auditEvent } from "../../src/db/schema";
import type { NewVideo } from "../../src/db/schema/types";
import type { VideoExclusiveMode } from "../../src/lib/domain/values";
import {
  MUSIC_DISABLED_USES,
  type MusicUseKey,
} from "../../src/lib/videos/rights";
import { auditsOf } from "./connect-flow";

/** Stored music Yes with both music uses off, as attestRights leaves it (the house pattern; the factory writes No). */
export const MUSIC_YES = {
  containsMusic: true,
  disabledUses: [...MUSIC_DISABLED_USES],
} satisfies Partial<NewVideo>;

/** The video's `action` audits, oldest first (each save is its own transaction, so `created_at` orders them). */
export const auditsInOrder = (
  videoId: string,
  action: "video.price_set" | "video.use_toggled" | "video.exclusive_set",
) => auditsOf(videoId, action).orderBy(asc(auditEvent.createdAt));

/** Every audit row on the video, any action. */
export const anyAuditsOf = (videoId: string) =>
  db
    .select({ action: auditEvent.action })
    .from(auditEvent)
    .where(eq(auditEvent.entityId, videoId));

/** One `video.price_set` row the creator wrote (CAD creators). */
export const priceSet = (fromCents: number | null, toCents: number | null) => ({
  data: { fromCents, toCents, currency: "cad" },
  actorType: "creator",
});

/** One `video.use_toggled` row the creator wrote. */
export const toggled = (useKey: MusicUseKey, enabled: boolean) => ({
  data: { useKey, enabled },
  actorType: "creator",
});

/** One `video.exclusive_set` row the creator wrote. */
export const exclusiveSet = (
  fromMode: VideoExclusiveMode,
  fromMultiplierBps: number | null,
  toMode: VideoExclusiveMode,
  toMultiplierBps: number | null,
) => ({
  data: { fromMode, fromMultiplierBps, toMode, toMultiplierBps },
  actorType: "creator",
});
