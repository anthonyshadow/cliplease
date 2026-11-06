import "server-only";
import type { BuyerStatus } from "@/lib/licensing/request-dto";
import { errorName, logEvent } from "../log";
import { findRequestForBuyer } from "../tokens/buyer-token";
import { releaseCheckoutHold } from "./checkout-hold";
import { settleBuyerRequest } from "./lazy";
import { getBuyerStatus } from "./queries";
import { reconcileCheckoutReturn } from "./requests";

/**
 * The request a buyer link opens, or null for a dead link: a wrong key, an unknown id, anything malformed.
 * releaseOnCancel, reconcileCheckoutReturn and getBuyerStatus each check the key first, so a dead link asks Stripe
 * nothing and writes nothing (05 §10). A buyer who canceled at Checkout (`canceled`, Stripe's cancel_url) lets go of
 * their hold (owner answer Q-175). A buyer back from Checkout (`returnedSessionId`, Stripe's session_id) gets the request
 * confirmed from Stripe (02 §8.3); a waiting request that reads Processing… or Expired is then settled (a stuck claim,
 * its own expiry: settleBuyerRequest) and read again. If Stripe can't be read, the page shows the stored status and keeps
 * checking.
 */
export async function getBuyerRequest(
  requestId: string,
  token: string,
  returnedSessionId?: string,
  canceled = false,
): Promise<BuyerStatus | null> {
  if (canceled) await releaseOnCancel(requestId, token);
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
  const request = await getBuyerStatus(requestId, token);
  if (!request || !(await settleBuyerRequest(request))) return request;
  return getBuyerStatus(requestId, token);
}

/** The cancel_url's release, with the request's own key only. A failure is logged: the clock then ends the hold. */
async function releaseOnCancel(
  requestId: string,
  token: string,
): Promise<void> {
  try {
    const row = await findRequestForBuyer(requestId, token);
    if (row?.status === "checkout_pending") {
      await releaseCheckoutHold(row.id, "canceled");
    }
  } catch (error) {
    logEvent("warn", "license_request.hold_release_failed", {
      requestId,
      error: errorName(error),
    });
  }
}
