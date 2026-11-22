import "server-only";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { db, type Tx } from "../../db/client";
import { licenseRequest, video, videoPosting } from "../../db/schema";
import {
  type AdminDisableVideoData,
  type AdminDisableVideoInput,
  AdminDisableVideoSchema,
  type AdminEnableVideoInput,
  AdminEnableVideoSchema,
} from "../../lib/validation/admin";
import { writeAudit, writeAudits } from "../audit";
import { type Actor, type AdminActor, requireAdminActor } from "../auth/actor";
import { lockVideoForLicensing } from "../licensing/availability";
import { overdueColumn } from "../licensing/deadline";
import {
  declineLicenseRequest,
  expireLicenseRequest,
} from "../licensing/requests";
import { errorName, logEvent } from "../log";
import { refreshVideoOwnership } from "../postings/ownership";
import { VideoNotFoundError } from "./errors";

// Disable and Enable a video (02 §5.6, §6.1; 01 A.4, A.6, J8.10; 07 D24, D28, D34, D45, D66, D88; owner answers Q-197 a,
// Q-198 a, Q-202; design/P21-admin-view.md §4.2–§4.4). Disable is one short transaction under the video's licensing
// lock (the lock every checkout, authorization and capture claim takes first), then a sweep of the waiting requests
// outside any transaction, each through the state machine's own decline or expiry. Enable is one short transaction under
// the same lock. Each effective action writes one audit row; a no-op writes none.

/** The sweep starts no request after this long: the page's maxDuration is 60 s (07 D26). */
const DISABLE_SWEEP_BUDGET_MS = 45_000;

type AdminSetVideoDisabledInput =
  | ({ disabled: true } & AdminDisableVideoInput)
  | ({ disabled: false } & AdminEnableVideoInput);

/**
 * What Disable leaves (owner answers Q-198 a, Q-202): of the video's waiting requests the sweep couldn't end,
 * `capturing`, those whose claim is a capture (a payment already going through when the video was disabled: its license
 * may still be issued), and `stillOpen`, the others (nothing can charge them, 07 D24); then `disabled`, whether the video
 * is still disabled after the sweep (another admin may have enabled it, 07 D88).
 */
export type AdminDisableResult = {
  stillOpen: number;
  capturing: number;
  disabled: boolean;
};

/**
 * An admin's Disable (`disabled: true`) or Enable (`disabled: false`) of video `videoId`. Any actor but an admin is a
 * programming error (requireAdminActor throws); input that doesn't parse is a ZodError; an unknown video is
 * VideoNotFoundError.
 *
 * Disable, from draft, published or unpublished: in one transaction under lockVideoForLicensing, status disabled with
 * disabled_at, the reason and the note; every verified posting released (unverified / released, verified_at and the
 * social ids kept) with one `video_posting.released { videoId, platform }` each; the same-video tick cleared when any
 * was released (07 D69); refreshVideoOwnership; `video.disabled { reason, note }`. Already disabled: nothing written,
 * no audit. Then, outside any transaction, the sweep (sweepWaiting). checkout_pending requests are left to
 * markAuthorized's video guard (abandoned / video_unavailable, 07 D27, D28); licenses already sold keep their snapshot.
 * `sweepOnly` (the sheet's Try again): the sweep alone, never the disable's transaction, so a Try again after another
 * admin's Enable never disables the video again; on a video that isn't disabled now it sweeps nothing.
 *
 * Enable, from disabled only: status unpublished, the disabled fields cleared, `video.enabled { previousReason }`, in
 * one transaction under the same lock. The released postings stay unverified until the creator's Check again (07 D66);
 * a disabled draft comes back unpublished too (07 D45), and Turn on runs every blocker. Not disabled: nothing.
 */
export async function adminSetVideoDisabled(
  a: Actor,
  input: Extract<AdminSetVideoDisabledInput, { disabled: true }>,
): Promise<AdminDisableResult>;
export async function adminSetVideoDisabled(
  a: Actor,
  input: Extract<AdminSetVideoDisabledInput, { disabled: false }>,
): Promise<undefined>;
export async function adminSetVideoDisabled(
  a: Actor,
  input: AdminSetVideoDisabledInput,
): Promise<AdminDisableResult | undefined> {
  const admin = requireAdminActor(a);
  if (!input.disabled) {
    await enableVideo(admin, AdminEnableVideoSchema.parse(input).videoId);
    return;
  }
  const i = AdminDisableVideoSchema.parse(input);
  if (i.sweepOnly) await existingVideo(i.videoId);
  else await disableVideo(admin, i);
  return sweepWaiting(admin, i.videoId);
}

/**
 * VideoNotFoundError unless video `videoId` exists, read before the transaction so its first statement is the lock:
 * lockVideoForLicensing throws a plain error for an unknown id (only a draft is ever deleted).
 */
async function existingVideo(videoId: string): Promise<void> {
  const [row] = await db
    .select({ id: video.id })
    .from(video)
    .where(eq(video.id, videoId));
  if (!row) throw new VideoNotFoundError();
}

/** Disable's transaction (design §4.2). */
async function disableVideo(
  admin: AdminActor,
  i: AdminDisableVideoData,
): Promise<void> {
  await existingVideo(i.videoId);
  await db.transaction(async (tx) => {
    const { status } = await lockVideoForLicensing(tx, i.videoId);
    if (status === "disabled") return;
    const released = await releasePostings(tx, admin, i.videoId);
    await tx
      .update(video)
      .set({
        status: "disabled",
        disabledAt: new Date(),
        disabledReason: i.reason,
        disabledNote: i.note ?? null,
        ...(released > 0 ? { sameVideoConfirmedAt: null } : {}),
      })
      .where(eq(video.id, i.videoId));
    await refreshVideoOwnership(tx, i.videoId);
    await writeAudit(tx, admin, {
      action: "video.disabled",
      entityType: "video",
      entityId: i.videoId,
      data: { reason: i.reason, note: i.note ?? null },
    });
  });
}

/**
 * Releases the video's verified postings (07 D66): unverified / released, every other column kept, so another creator
 * can verify the same post and the audit trail keeps who held it. One `video_posting.released` each, never the link.
 * Returns how many were released.
 */
async function releasePostings(
  tx: Tx,
  admin: AdminActor,
  videoId: string,
): Promise<number> {
  const released = await tx
    .update(videoPosting)
    .set({ verification: "unverified", unverifiedReason: "released" })
    .where(
      and(
        eq(videoPosting.videoId, videoId),
        eq(videoPosting.verification, "verified"),
      ),
    )
    .returning({ id: videoPosting.id, platform: videoPosting.platform });
  await writeAudits(
    tx,
    admin,
    released.map((posting) => ({
      action: "video_posting.released",
      entityType: "video_posting",
      entityId: posting.id,
      data: { videoId, platform: posting.platform },
    })),
  );
  return released.length;
}

/** The video's waiting requests, soonest deadline first, each overdue or not on the database's clock (02 §8.4). */
function waitingRequests(videoId: string) {
  return db
    .select({ id: licenseRequest.id, overdue: overdueColumn })
    .from(licenseRequest)
    .where(
      and(
        eq(licenseRequest.videoId, videoId),
        eq(licenseRequest.status, "awaiting_approval"),
      ),
    )
    .orderBy(asc(licenseRequest.expiresAt), asc(licenseRequest.id));
}

/** Whether the video is still disabled: another admin may have enabled it during the sweep (07 D88). */
async function stillDisabled(videoId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: video.status })
    .from(video)
    .where(eq(video.id, videoId));
  return row?.status === "disabled";
}

/**
 * Disable's sweep (design §4.3; 07 D24, D28; 03 T8, T9), outside any transaction, one request at a time: an overdue one
 * expires (expireLicenseRequest), any other is declined as `video_disabled` through the decline claim
 * (declineLicenseRequest: the cancel with requested_by_customer under `pi-cancel:<id>:decline:<attempt>`, then the
 * fenced finish and the buyer's request-declined; the creator gets no email, 07 D34). A request another claim holds is
 * left to its holder. No request starts after DISABLE_SWEEP_BUDGET_MS, or while the video isn't disabled (so none on a
 * video another admin enabled); one that fails is logged and the rest go on. Returns the video's waiting requests left
 * after it, split by whether their claim is a capture (Q-202), then whether the video is still disabled, read in that
 * order: an Enable between the two reads reads as enabled.
 */
async function sweepWaiting(
  admin: AdminActor,
  videoId: string,
): Promise<AdminDisableResult> {
  const stopAt = Date.now() + DISABLE_SWEEP_BUDGET_MS;
  for (const request of await waitingRequests(videoId)) {
    if (Date.now() >= stopAt || !(await stillDisabled(videoId))) break;
    try {
      if (request.overdue) await expireLicenseRequest(request.id, admin);
      else await declineLicenseRequest(request.id, admin, "video_disabled");
    } catch (error) {
      logEvent("warn", "video.disable_sweep_failed", {
        requestId: request.id,
        error: errorName(error),
      });
    }
  }
  const [left] = await db
    .select({
      waiting: count(),
      capturing:
        sql<number>`count(*) filter (where ${licenseRequest.paymentAction} = 'capture')`.mapWith(
          Number,
        ),
    })
    .from(licenseRequest)
    .where(
      and(
        eq(licenseRequest.videoId, videoId),
        eq(licenseRequest.status, "awaiting_approval"),
      ),
    );
  const capturing = left?.capturing ?? 0;
  return {
    stillOpen: (left?.waiting ?? 0) - capturing,
    capturing,
    disabled: await stillDisabled(videoId),
  };
}

/** Enable's transaction (design §4.4). */
async function enableVideo(admin: AdminActor, videoId: string): Promise<void> {
  await existingVideo(videoId);
  await db.transaction(async (tx) => {
    const { status } = await lockVideoForLicensing(tx, videoId);
    if (status !== "disabled") return;
    const [before] = await tx
      .select({ reason: video.disabledReason })
      .from(video)
      .where(eq(video.id, videoId));
    await tx
      .update(video)
      .set({
        status: "unpublished",
        disabledAt: null,
        disabledReason: null,
        disabledNote: null,
      })
      .where(eq(video.id, videoId));
    await writeAudit(tx, admin, {
      action: "video.enabled",
      entityType: "video",
      entityId: videoId,
      data: { previousReason: before?.reason ?? null },
    });
  });
}
