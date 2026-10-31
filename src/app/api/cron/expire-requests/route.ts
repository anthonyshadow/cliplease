import { CRON } from "@/server/auth/actor";
import { isCronAuthorized } from "@/server/cron/auth";
import { retryEmailOutbox } from "@/server/email/send";
import { NO_STORE, unauthorizedJson } from "@/server/http";
import { expireDueRequests } from "@/server/licensing/requests";
import { reconcileStuckClaims } from "@/server/licensing/state-machine";
import { errorName, logEvent } from "@/server/log";

// GET /api/cron/expire-requests (02 §8.4 layer 2, §9.7; 07 D26, D34, D57): Vercel Cron from [H10], curled locally (the
// README) and from e2e until then. Without `Bearer <CRON_SECRET>` it answers the API's 401 and runs nothing. Otherwise
// passes of the steps below until none is due or the budget is spent, then the totals as JSON, never cached. Safe to
// run twice: every step claims or fences what it changes. The Authorization header is never logged.

/** A run, up to its last Stripe call and that call's finish (07 D26). */
export const maxDuration = 60;

/** No step starts once this much of maxDuration is spent: the rest is for the step still running and the answer. */
const CRON_BUDGET_MS = 45_000;

/** The JSON (02 §8.4): each step's total over the run's passes, in 02 §8.4's key order. */
type CronCounts = { expired: number; reconciled: number; emailsSent: number };

type CronStep = {
  key: keyof CronCounts;
  /** The batch: a run that fills it may have left more, and only that keeps the step due for another pass. */
  limit: number;
  /** How many this run settled; no request, claim or email starts at or after `stopAt` (epoch ms). */
  run: (limit: number, stopAt: number) => Promise<number>;
};

// The reconcile runs first (06 §9, as the lazy layers do), so a claim it releases on an overdue request expires in the
// same pass. P19b adds sweepMoneyMovements ({ olderThanMinutes: 10, limit: 50 }, moneyMovements) after the expiry,
// and P19c retryAutoApprovals ({ limit: 50 }, autoApprovals) before the outbox. P33a adds abandonStaleCheckouts
// (abandoned) before the outbox too, and runs cleanupExpiredRecords once after the loop (the `cleaned` object).
const STEPS: readonly CronStep[] = [
  {
    key: "reconciled",
    limit: 50,
    run: (limit, stopAt) =>
      reconcileStuckClaims({
        olderThanMinutes: 10,
        limit,
        actor: CRON,
        stopAt,
      }),
  },
  {
    key: "expired",
    limit: 100,
    run: (limit, stopAt) => expireDueRequests({ limit, actor: CRON, stopAt }),
  },
  {
    key: "emailsSent",
    limit: 50,
    run: (limit, stopAt) => retryEmailOutbox({ limit, stopAt }),
  },
];

/**
 * Passes of the due steps (02 §8.4: "until nothing is due"). Every step runs in the first pass; after that only a step
 * whose last run filled its batch, so a request, claim or email that failed in this run isn't tried twice (its step
 * fell short; P22d's renewals cron keeps the same rule). No step starts at or after `stopAt`.
 */
async function sweep(stopAt: number): Promise<CronCounts> {
  const counts: CronCounts = { expired: 0, reconciled: 0, emailsSent: 0 };
  let due = STEPS;
  while (due.length > 0) {
    const again: CronStep[] = [];
    for (const step of due) {
      if (Date.now() >= stopAt) return counts;
      const settled = await step.run(step.limit, stopAt);
      counts[step.key] += settled;
      if (settled >= step.limit) again.push(step);
    }
    due = again;
  }
  return counts;
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"))) {
    return unauthorizedJson();
  }
  try {
    const counts = await sweep(Date.now() + CRON_BUDGET_MS);
    return Response.json(counts, { headers: NO_STORE });
  } catch (error) {
    // A step's opening query failed (the steps themselves log and skip what fails per row): the name only, since a
    // database error's message can hold bound values.
    logEvent("error", "cron.expire_requests_failed", {
      error: errorName(error),
    });
    return Response.json(
      { error: { code: "cron_failed" } },
      { status: 500, headers: NO_STORE },
    );
  }
}
