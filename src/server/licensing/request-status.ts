import "server-only";
import type { BuyerStatus } from "@/lib/licensing/request-dto";
import { errorName, logEvent } from "../log";
import { settleBuyerRequest } from "./lazy";
import { getBuyerStatus } from "./queries";
import { reconcileCheckoutReturn } from "./requests";

/**
 * The request a buyer link opens, or null for a dead link: a wrong key, an unknown id, anything malformed.
 * reconcileCheckoutReturn and getBuyerStatus each check the key first, so a dead link asks Stripe nothing and writes
 * nothing (05 §10). A buyer back from Checkout (`returnedSessionId`, Stripe's session_id) gets the request confirmed
 * from Stripe (02 §8.3); a waiting request that reads Processing… or Expired is then settled (a stuck claim, its own
 * expiry: settleBuyerRequest) and read again. If Stripe can't be read, the page shows the stored status and keeps
 * checking.
 */
export async function getBuyerRequest(
  requestId: string,
  token: string,
  returnedSessionId?: string,
): Promise<BuyerStatus | null> {
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
