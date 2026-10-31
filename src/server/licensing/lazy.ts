import "server-only";
import type { BuyerStatus } from "@/lib/licensing/request-dto";
import { errorName, logEvent } from "../log";
import { afterResponse } from "./effects";
import { expireDueRequests } from "./requests";
import { reconcileStuckClaims, STUCK_CLAIM_MINUTES } from "./state-machine";

// The lazy layers of expiry and stuck claims (02 §8.4; 07 D25, D26, D57): what a request page does about its requests
// before it shows them, and after it responds. The reads themselves stay pure (queries.ts), so admin pages, which call
// none of this, never expire anything.

/** How long a creator's page waits on stuck-claim reads before it renders: claims not reached keep reading Processing…. */
const SETTLE_BUDGET_MS = 5_000;

/**
 * Before a creator's page reads its requests (the Inbox, or one request's page with `requestId`): their claims stuck
 * for over 2 minutes are reconciled, so the page shows Stripe's outcome instead of Processing…; after the response,
 * their overdue requests expire. Until then the pages show them Expired, without "not charged" (owner answer Q-142 a).
 * Scoped to `creatorId`, so another creator's request id does nothing.
 */
export async function settleCreatorRequests({
  creatorId,
  requestId,
}: {
  creatorId: string;
  requestId?: string;
}): Promise<void> {
  await reconcileStuckClaims({
    creatorId,
    requestId,
    olderThanMinutes: STUCK_CLAIM_MINUTES,
    limit: 10,
    stopAt: Date.now() + SETTLE_BUDGET_MS,
  });
  afterResponse(() => expireDueRequests({ creatorId, requestId }));
}

/**
 * Before /r shows a waiting request its link opened as Processing… or Expired (owner answer Q-142 a; 07 D25): a stuck
 * claim reconciled, then its own expiry awaited when due (the due query's database clock decides), so "No answer in
 * time" shows only once Stripe has released the hold. True when the request may have changed, so the caller reads it
 * again; false for any other request, and for a claim nothing resolved. Never throws: after a failure /r shows the
 * stored status (waiting, or Processing… while a claim holds). The caller has checked the link's key.
 */
export async function settleBuyerRequest(
  request: Pick<BuyerStatus, "id" | "status" | "displayStatus">,
): Promise<boolean> {
  if (
    request.status !== "awaiting_approval" ||
    request.displayStatus === "awaiting_approval"
  ) {
    return false;
  }
  try {
    if (request.displayStatus === "processing") {
      const resolved = await reconcileStuckClaims({
        requestId: request.id,
        olderThanMinutes: STUCK_CLAIM_MINUTES,
      });
      if (resolved === 0) return false;
    }
    await expireDueRequests({ requestId: request.id, limit: 1 });
  } catch (error) {
    logEvent("warn", "license_request.lazy_expiry_failed", {
      requestId: request.id,
      error: errorName(error),
    });
  }
  return true;
}
