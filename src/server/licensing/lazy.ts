import "server-only";
import type { PayoutsStatus } from "@/lib/domain/values";
import type { BuyerStatus } from "@/lib/licensing/request-dto";
import { errorName, logEvent } from "../log";
import { retryAutoApprovals } from "./auto-approve";
import { afterResponse } from "./effects";
import { sweepMoneyMovements } from "./money";
import { expireDueRequests } from "./requests";
import { reconcileStuckClaims, STUCK_CLAIM_MINUTES } from "./state-machine";

// The lazy layers of expiry, stuck claims, auto-approvals and creator transfers (02 §8.4; 07 D25, D26, D57, D75, D81):
// what a page does about its requests before it shows them, and after it responds. The reads themselves stay pure
// (queries.ts), so admin pages, which call none of this, never expire, approve or pay anything.

/** How long a creator's page waits on stuck-claim reads before it renders: claims not reached keep reading Processing…. */
const SETTLE_BUDGET_MS = 5_000;

/** How long the work a page schedules after its response (transfers, auto-approvals) may start: well inside 60 s. */
const AFTER_BUDGET_MS = 45_000;

/**
 * Before a creator's page reads its requests (the Inbox, or one request's page with `requestId`): their claims stuck
 * for over 2 minutes are reconciled, so the page shows Stripe's outcome instead of Processing…; after the response,
 * their overdue requests expire, and their auto-approvals that didn't finish are retried (07 D81; owner answer Q-156).
 * Until then the pages show them Expired, without "not charged" (owner answer Q-142 a). Scoped to `creatorId`, so
 * another creator's request id does nothing.
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
  const stopAt = Date.now() + AFTER_BUDGET_MS;
  afterResponse(() =>
    retryAutoApprovals({ creatorId, requestId, limit: 10, stopAt }),
  );
}

/**
 * Before /r shows a waiting request its link opened as Processing… or Expired (owner answer Q-142 a; 07 D25): a stuck
 * claim reconciled, then its own expiry awaited when due (the due query's database clock decides), so "No answer in
 * time" shows only once Stripe has released the hold. True when the request may have changed, so the caller reads it
 * again; false for any other request, and for a claim nothing resolved. An auto-approving request also schedules its
 * retry after the response (owner answer Q-156), claimed or not: the retry's own query decides. Never throws: after a
 * failure /r shows the stored status (waiting, or Processing… while a claim holds). The caller has checked the link's
 * key.
 */
export async function settleBuyerRequest(
  request: Pick<
    BuyerStatus,
    "id" | "status" | "displayStatus" | "autoApproving"
  >,
): Promise<boolean> {
  if (
    request.status !== "awaiting_approval" ||
    request.displayStatus === "awaiting_approval"
  ) {
    return false;
  }
  if (request.autoApproving) {
    const stopAt = Date.now() + AFTER_BUDGET_MS;
    afterResponse(() =>
      retryAutoApprovals({ requestId: request.id, limit: 1, stopAt }),
    );
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

/**
 * The creator's transfers on a payouts page (07 D75; 03 §7.8): once payouts are on, the pending and failed ones are sent.
 * With `wait` (Settings back from payout setup), awaited within the settle budget, so the page's Banner shows the result;
 * without, after the response. Rows not reached go on the next load or by the cron. Never throws.
 */
export async function settleCreatorMoney({
  creatorId,
  payoutsStatus,
  wait,
}: {
  creatorId: string;
  payoutsStatus: PayoutsStatus;
  wait: boolean;
}): Promise<void> {
  if (payoutsStatus !== "active") return;
  // The budget counts from now, the request's work, not from when after() starts.
  const stopAt = Date.now() + (wait ? SETTLE_BUDGET_MS : AFTER_BUDGET_MS);
  const sweep = () => sweepMoneyMovements({ creatorId, limit: 50, stopAt });
  if (!wait) {
    afterResponse(sweep);
    return;
  }
  await sweep().catch((error: unknown) => {
    logEvent("warn", "money_movement.lazy_sweep_failed", {
      creatorId,
      error: errorName(error),
    });
  });
}
