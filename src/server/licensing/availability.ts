import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { license, licenseRequest, video } from "@/db/schema";
import type { VideoStatus } from "@/lib/domain/values";
import {
  type AvailabilityFacts,
  availabilityRefusal,
  deriveAvailability,
  type LicenseAvailability,
} from "@/lib/licensing/availability";
import {
  effectiveOptions,
  getRateCard,
  VIDEO_PRICING_COLUMNS,
  videoPricingOf,
} from "../pricing/rate-card";
import type { DeclineReason } from "./state-machine";

// Whether a video can be licensed right now (07 §9.2, D110; owner answer Q-170): the video row lock every request that
// creates, authorizes or extends a hold takes first, and the facts deriveAvailability reads. A display read needs no
// lock; a decision reads them after the lock, in its own statement, on the database's clock.

/** db, or a transaction: anything that can select. */
type Reader = Pick<typeof db, "select">;

/** No renewal reservation until P22g fills these from renewal_plan. */
const EMPTY_FACTS: AvailabilityFacts = {
  runningExclusiveUntil: null,
  runningNonExclusive: false,
  pendingExclusive: false,
  pendingNonExclusive: false,
  reservationUntil: null,
  reservationPlanId: null,
};

/** A license that hasn't ended or been revoked: an upcoming term counts as running. */
const RUNNING = sql`l.revoked_at is null and (l.ends_at is null or l.ends_at > now())`;

/**
 * A request holding the video, other than `self`: unpaid while its session and its hold both run (owner answer Q-170), or
 * paid for its whole approval window, and past it while a capture claim is held (owner answer Q-182: a capture that may
 * have taken the money holds the video until it is finished, released or failed). Drizzle leaves a query over `video`
 * unqualified, so the subquery writes its name.
 */
const pending = (self: string | null) =>
  sql`r.video_id = ${video}.id and r.id is distinct from ${self}::uuid
  and ((r.status = 'checkout_pending' and r.checkout_expires_at > now() and r.checkout_hold_until > now())
    or (r.status = 'awaiting_approval' and (r.expires_at > now() or r.payment_action = 'capture')))`;

/**
 * Each video's facts in one statement, one snapshot: a capture committing can't fall between licenses and requests. No
 * ids sends no query; `excludeRequestId` leaves a request out of its own check.
 */
export async function availabilityFactsByVideo(
  q: Reader,
  videoIds: readonly string[],
  { excludeRequestId }: { excludeRequestId?: string } = {},
): Promise<(videoId: string) => AvailabilityFacts> {
  if (videoIds.length === 0) return () => EMPTY_FACTS;
  const self = excludeRequestId ?? null;
  const rows = await q
    .select({
      videoId: video.id,
      runningExclusiveUntil:
        sql<Date | null>`(select max(l.ends_at) from ${license} l where l.video_id = ${video}.id and l.exclusive and ${RUNNING})`.mapWith(
          license.endsAt,
        ),
      runningNonExclusive: sql<boolean>`exists(select 1 from ${license} l where l.video_id = ${video}.id and not l.exclusive and ${RUNNING})`,
      pendingExclusive: sql<boolean>`exists(select 1 from ${licenseRequest} r where r.exclusive and ${pending(self)})`,
      pendingNonExclusive: sql<boolean>`exists(select 1 from ${licenseRequest} r where not r.exclusive and ${pending(self)})`,
    })
    .from(video)
    .where(inArray(video.id, [...videoIds]));
  const byVideo = new Map<string, AvailabilityFacts>(
    rows.map(({ videoId, ...facts }) => [
      videoId,
      { ...EMPTY_FACTS, ...facts },
    ]),
  );
  return (videoId) => byVideo.get(videoId) ?? EMPTY_FACTS;
}

/** What is running or waiting on the video; `excludeRequestId` leaves a request out of its own check. */
export async function loadAvailabilityFacts(
  q: Reader,
  videoId: string,
  opts: { excludeRequestId?: string } = {},
): Promise<AvailabilityFacts> {
  const factsFor = await availabilityFactsByVideo(q, [videoId], opts);
  return factsFor(videoId);
}

/** Request `requestId`'s video: a plain read (the video id never changes) that may come before the video's lock. */
export async function requestVideoId(
  q: Reader,
  requestId: string,
): Promise<string | null> {
  const [row] = await q
    .select({ videoId: licenseRequest.videoId })
    .from(licenseRequest)
    .where(eq(licenseRequest.id, requestId));
  return row?.videoId ?? null;
}

/**
 * The video row FOR UPDATE, taken by any transaction that creates, authorizes, extends, claims to capture or finishes
 * the decline of a request (07 D110, D111): the video before any license_request row lock, everywhere (a plain read of
 * the request's video id may come first). Its status comes with it, read under the lock.
 */
export async function lockVideoForLicensing(
  tx: Tx,
  videoId: string,
): Promise<{ status: VideoStatus }> {
  const [row] = await tx
    .select({ id: video.id, status: video.status })
    .from(video)
    .where(eq(video.id, videoId))
    .for("update");
  if (!row) throw new Error("lockVideoForLicensing: unknown video");
  return { status: row.status };
}

/**
 * The video's availability, its offer from the video and its creator's card. Under lockVideoForLicensing, pass the
 * transaction: every read goes through `q`, or a second connection held under the lock could starve the pool.
 */
export async function getLicenseAvailability(
  q: Reader,
  videoId: string,
): Promise<LicenseAvailability> {
  const [row] = await q
    .select({ creatorId: video.creatorId, ...VIDEO_PRICING_COLUMNS })
    .from(video)
    .where(eq(video.id, videoId));
  if (!row) throw new Error("getLicenseAvailability: unknown video");
  const { exclusive } = effectiveOptions(
    await getRateCard(row.creatorId, q),
    videoPricingOf(row),
  );
  return deriveAvailability(
    await loadAvailabilityFacts(q, videoId),
    exclusive.offered,
  );
}

/**
 * Whether request `requestId` can still go on (T2, and extending its hold), under the video's lock, leaving itself out.
 * Offered is taken as true: turning the offer off never strands a request made while it was on (01 J12.13).
 */
export async function assertStillLicensable(
  tx: Tx,
  requestId: string,
): Promise<{ ok: true } | { ok: false; reason: "exclusive_conflict" }> {
  const [row] = await tx
    .select({
      videoId: licenseRequest.videoId,
      exclusive: licenseRequest.exclusive,
    })
    .from(licenseRequest)
    .where(eq(licenseRequest.id, requestId));
  if (!row) throw new Error("assertStillLicensable: unknown request");
  const facts = await loadAvailabilityFacts(tx, row.videoId, {
    excludeRequestId: requestId,
  });
  return availabilityRefusal(deriveAvailability(facts, true), row.exclusive)
    ? { ok: false, reason: "exclusive_conflict" }
    : { ok: true };
}

/**
 * Whether waiting request `requestId` no longer fits its video (07 D111), read under the video's lock in a short
 * transaction of its own, as a decision needs it. False for an unknown request.
 */
export async function hasExclusiveConflict(
  requestId: string,
): Promise<boolean> {
  const videoId = await requestVideoId(db, requestId);
  if (!videoId) return false;
  return db.transaction(async (tx) => {
    await lockVideoForLicensing(tx, videoId);
    return !(await assertStillLicensable(tx, requestId)).ok;
  });
}

/**
 * Why a decline claim on request `requestId` ended, when its finish doesn't say (07 D28, D111): the video's lock first,
 * then the video disabled → video_disabled; the request no longer fits the video → exclusive_conflict; else `fallback`,
 * the decline's own reason (creator unless known). Inside the finish's transaction, before the request's own lock.
 */
export async function declineReasonFor(
  tx: Tx,
  requestId: string,
  fallback: DeclineReason = "creator",
): Promise<DeclineReason> {
  const videoId = await requestVideoId(tx, requestId);
  if (!videoId) throw new Error("declineReasonFor: unknown request");
  const { status } = await lockVideoForLicensing(tx, videoId);
  if (status === "disabled") return "video_disabled";
  return (await assertStillLicensable(tx, requestId)).ok
    ? fallback
    : "exclusive_conflict";
}
