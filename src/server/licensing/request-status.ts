import "server-only";
import type { BuyerStatus } from "@/lib/licensing/request-dto";
import { errorName, logEvent } from "../log";
import { getBuyerStatus } from "./queries";
import { reconcileCheckoutReturn } from "./requests";

/**
 * The request a buyer link opens, or null for a dead link: a wrong key, an unknown id, anything malformed. A buyer
 * back from Checkout (`returnedSessionId`, Stripe's session_id) first gets the request confirmed from Stripe (02 §8.3);
 * if Stripe can't be read, the page shows the stored status and keeps checking.
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
  return getBuyerStatus(requestId, token);
}
