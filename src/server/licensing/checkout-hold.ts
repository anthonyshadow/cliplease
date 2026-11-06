import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { licenseRequest } from "@/db/schema";
import {
  CHECKOUT_HOLD_EXTEND_WINDOW_SECONDS,
  CHECKOUT_HOLD_MINUTES,
  type ExtendHoldResult,
  type HoldReleaseVia,
} from "@/lib/licensing/checkout-hold";
import { writeAudit } from "../audit";
import { assertStillLicensable, lockVideoForLicensing } from "./availability";

// The unpaid hold's two writes (owner answers Q-170, Q-175): extending it and letting it go. Callers check the request's
// key first. Neither writes `status` nor calls the payments driver; a released or lapsed row stays checkout_pending until
// its session ends, holds nothing, and paying it goes through T2's re-check.

/** The client's clock rounds up, so a press in the last minute can reach the server a moment early. */
const EXTEND_TOLERANCE_SECONDS = 5;

/**
 * Ten more minutes on request `requestId`'s hold, up to its session's end, unless the video went elsewhere meanwhile. One
 * transaction, the video's lock first (07 D110; a plain read of its id isn't a lock). Decided on now(), while the times
 * returned carry clock_timestamp(), since now() is the transaction's start and a wait for the lock would skew the client.
 */
export async function extendCheckoutHold(
  requestId: string,
): Promise<ExtendHoldResult> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ videoId: licenseRequest.videoId })
      .from(licenseRequest)
      .where(eq(licenseRequest.id, requestId));
    if (!target) return { ok: false, reason: "not_pending" };
    const { status: videoStatus } = await lockVideoForLicensing(
      tx,
      target.videoId,
    );
    const [row] = await tx
      .select({
        status: licenseRequest.status,
        holdUntil: licenseRequest.checkoutHoldUntil,
        sessionEndsAt: licenseRequest.checkoutExpiresAt,
        now: sql<Date>`now()`.mapWith(licenseRequest.checkoutExpiresAt),
        clockNow: sql<Date>`clock_timestamp()`.mapWith(
          licenseRequest.checkoutExpiresAt,
        ),
      })
      .from(licenseRequest)
      .where(eq(licenseRequest.id, requestId));
    if (row?.status !== "checkout_pending") {
      return { ok: false, reason: "not_pending" };
    }
    const { holdUntil, sessionEndsAt, now, clockNow } = row;
    if (now >= sessionEndsAt) return { ok: false, reason: "session_ended" };
    const times = {
      holdUntil: holdUntil.toISOString(),
      sessionEndsAt: sessionEndsAt.toISOString(),
      now: clockNow.toISOString(),
    };
    const secondsLeft = (holdUntil.getTime() - now.getTime()) / 1000;
    if (
      secondsLeft >
      CHECKOUT_HOLD_EXTEND_WINDOW_SECONDS + EXTEND_TOLERANCE_SECONDS
    ) {
      return { ok: false, reason: "too_early", ...times };
    }
    if (holdUntil >= sessionEndsAt) {
      return { ok: false, reason: "at_limit", ...times };
    }
    if (videoStatus !== "published") {
      return { ok: false, reason: "video_unavailable" };
    }
    if (!(await assertStillLicensable(tx, requestId)).ok) {
      return { ok: false, reason: "taken" };
    }
    const [updated] = await tx
      .update(licenseRequest)
      .set({
        checkoutHoldUntil: sql`least(greatest(${licenseRequest.checkoutHoldUntil}, now()) + make_interval(mins => ${CHECKOUT_HOLD_MINUTES}::int), ${licenseRequest.checkoutExpiresAt})`,
      })
      .where(
        and(
          eq(licenseRequest.id, requestId),
          eq(licenseRequest.status, "checkout_pending"),
        ),
      )
      .returning({
        holdUntil: licenseRequest.checkoutHoldUntil,
        sessionEndsAt: licenseRequest.checkoutExpiresAt,
        now: sql<Date>`clock_timestamp()`.mapWith(
          licenseRequest.checkoutExpiresAt,
        ),
      });
    if (!updated) return { ok: false, reason: "not_pending" };
    const extended = updated.holdUntil.toISOString();
    await writeAudit(
      tx,
      { kind: "buyer", requestId },
      {
        action: "license_request.hold_extended",
        entityType: "license_request",
        entityId: requestId,
        data: { holdUntil: extended },
      },
    );
    return {
      ok: true,
      holdUntil: extended,
      sessionEndsAt: updated.sessionEndsAt.toISOString(),
      now: updated.now.toISOString(),
    };
  });
}

/**
 * Lets go of request `requestId`'s hold now, so the video opens for everyone (owner answer Q-175): that row only, while
 * it is unpaid and still holding, and audited only then, so it can run twice. No video lock: it only shortens.
 */
export async function releaseCheckoutHold(
  requestId: string,
  via: HoldReleaseVia,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [released] = await tx
      .update(licenseRequest)
      .set({ checkoutHoldUntil: sql`now()` })
      .where(
        and(
          eq(licenseRequest.id, requestId),
          eq(licenseRequest.status, "checkout_pending"),
          sql`${licenseRequest.checkoutHoldUntil} > now()`,
        ),
      )
      .returning({ id: licenseRequest.id });
    if (released) {
      await writeAudit(
        tx,
        { kind: "buyer", requestId },
        {
          action: "license_request.hold_released",
          entityType: "license_request",
          entityId: requestId,
          data: { via },
        },
      );
    }
  });
}
