import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { creatorProfile, video } from "@/db/schema";
import type { Currency, LicenseRequestStatus } from "@/lib/domain/values";
import { errorName, logEvent } from "../log";
import { findRequestForBuyer } from "../tokens/buyer-token";
import { reconcileCheckoutReturn } from "./requests";

/**
 * What /r shows of a request (02 §4.1): its status and why, the hold's total and deadline (an ISO instant: the page
 * formats it in the viewer's zone), and the license page's address. P17 adds the rest.
 */
export type BuyerRequest = {
  status: LicenseRequestStatus;
  statusReason: string | null;
  amountTotalCents: number;
  currency: Currency;
  expiresAt: string | null;
  handle: string;
  slug: string;
};

/**
 * The request a buyer link opens, or null for a dead link: a wrong key, an unknown id, anything malformed. A buyer
 * back from Checkout (`returnedSessionId`, Stripe's session_id) first gets the request confirmed from Stripe (02 §8.3);
 * if Stripe can't be read, the page shows the stored status and keeps checking.
 */
export async function getBuyerRequest(
  requestId: string,
  token: string,
  returnedSessionId?: string,
): Promise<BuyerRequest | null> {
  if (returnedSessionId) {
    try {
      await reconcileCheckoutReturn(requestId, token, returnedSessionId);
    } catch (error) {
      logEvent("warn", "license_request.return_failed", {
        requestId,
        error: errorName(error),
      });
    }
  }
  const request = await findRequestForBuyer(requestId, token);
  if (!request) return null;
  // The video always exists: license_request's FK to it restricts deletes.
  const [page] = await db
    .select({ handle: creatorProfile.handle, slug: video.slug })
    .from(video)
    .innerJoin(creatorProfile, eq(creatorProfile.id, video.creatorId))
    .where(eq(video.id, request.videoId));
  if (!page) return null;
  return {
    status: request.status,
    statusReason: request.statusReason,
    amountTotalCents: request.amountTotalCents,
    currency: request.currency,
    expiresAt: request.expiresAt?.toISOString() ?? null,
    ...page,
  };
}
