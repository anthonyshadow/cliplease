// A demo request's way through the domain, for the [int] tests that follow one after a price change (P19d, P19e): the
// request as the action parses it, its exclusive form on a creator who offers it (P19f), its unpaid hold (P19f), T2, the
// creator's Approve and what the request stores. Apart from video-price-fixtures.ts, whose Server Action tests don't load
// the licensing server code. Tests only.
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect } from "vitest";
import { db } from "../../src/db/client";
import { licenseRequest } from "../../src/db/schema";
import type { LicenseRequest } from "../../src/db/schema/types";
import { StartCheckoutSchema } from "../../src/lib/validation/checkout";
import { type Actor, WEBHOOK } from "../../src/server/auth/actor";
import { approveLicenseRequest } from "../../src/server/licensing/approve";
import {
  createLicenseRequest,
  markAuthorized,
} from "../../src/server/licensing/requests";
import { saveRateCard } from "../../src/server/pricing/rate-card";
import type { RequestContext } from "../../src/server/request-context";
import { approvingCreatorWithVideo } from "./approval-fixtures";
import { DEMO_REQUEST } from "./checkout-fixtures";
import { requestRow } from "./factories";
import { cardWith } from "./rate-card-fixtures";

export const REQUEST_CTX: RequestContext = {
  ip: "203.0.113.7",
  userAgent: "Mozilla/5.0 (test)",
};

/** The J4.7 quote at the rate card's CA$150, standard: CA$1,575.00 + CA$157.50 = CA$1,732.50. */
export const RATE_CARD_AMOUNTS = {
  licensePriceCents: 157500,
  platformFeeCents: 15750,
  amountTotalCents: 173250,
} as const;

/** The exclusive demo request at ×3.00: CA$4,725.00 + CA$472.50 = CA$5,197.50. */
export const EXCLUSIVE = {
  exclusive: true,
  expectedTotalCents: 519750,
} as const;

/** A fresh video on a creator who offers exclusive licenses at ×3.00. */
export async function offeringVideo() {
  const owner = await approvingCreatorWithVideo();
  await saveRateCard(owner.actor, cardWith(true, 30000));
  return owner;
}

/** The demo request (Paid social ads · 1 year · Worldwide at CA$1,732.50) for `videoId`, as the action parses it. */
export const checkoutInput = (
  videoId: string,
  change: Record<string, unknown> = {},
) =>
  StartCheckoutSchema.parse({
    ...DEMO_REQUEST,
    videoId,
    submissionId: randomUUID(),
    ...change,
  });

/** checkoutInput's request, which the server must take: the checkout_pending row it saved. */
export async function requested(
  videoId: string,
  change: Record<string, unknown> = {},
): Promise<LicenseRequest> {
  const input = checkoutInput(videoId, change);
  const result = await createLicenseRequest(input, REQUEST_CTX);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  const [row] = await db
    .select()
    .from(licenseRequest)
    .where(eq(licenseRequest.checkoutSubmissionId, input.submissionId));
  if (!row) throw new Error("no request");
  return row;
}

/** More attempts on one video than the pool has connections (10): while one holds its lock, the rest hold every connection. */
export const PAST_THE_POOL = 12;

/** `PAST_THE_POOL` standard requests on `videoId`, one after another: a standard row never stops the next. */
export async function requestedPastThePool(
  videoId: string,
): Promise<LicenseRequest[]> {
  const rows: LicenseRequest[] = [];
  for (let i = 0; i < PAST_THE_POOL; i += 1) {
    rows.push(await requested(videoId));
  }
  return rows;
}

/**
 * `attempt` on every item at once, well under the pool's 10 s connect timeout: under the video's lock, a read outside the
 * transaction would wait for a connection the queue behind the lock is holding (AD-56).
 */
export async function withoutStarvingPool<T, R>(
  items: readonly T[],
  attempt: (item: T) => Promise<R>,
): Promise<R[]> {
  const started = Date.now();
  const results = await Promise.all(items.map(attempt));
  expect(Date.now() - started).toBeLessThan(5_000);
  return results;
}

/**
 * Puts request `id`'s unpaid hold `seconds` from now on the database's clock, as availability and Extend read it (P19f); a
 * negative `seconds` back-dates it.
 */
export async function setHold(id: string, seconds: number): Promise<void> {
  const moved = await db
    .update(licenseRequest)
    .set({
      checkoutHoldUntil: sql`now() + make_interval(secs => ${seconds}::double precision)`,
    })
    .where(eq(licenseRequest.id, id))
    .returning({ id: licenseRequest.id });
  if (moved.length === 0) throw new Error("setHold: unknown request");
}

/** T2 as Stripe's webhook brings it (markAuthorized): the request now waits for the creator. */
export async function authorize(id: string): Promise<LicenseRequest> {
  await markAuthorized(id, WEBHOOK);
  const row = await requestRow(id);
  expect(row.status).toBe("awaiting_approval");
  return row;
}

/** The creator's Approve, which must succeed. */
export async function approve(id: string, actor: Actor): Promise<void> {
  const result = await approveLicenseRequest(id, actor);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
}

/** Every amount and multiplier a request stores, the exclusive pair included: all that stays through an approval. */
export const quoted = (r: LicenseRequest) => ({
  basePriceCents: r.basePriceCents,
  useMultiplierBps: r.useMultiplierBps,
  termMultiplierBps: r.termMultiplierBps,
  territoryMultiplierBps: r.territoryMultiplierBps,
  platformFeeBps: r.platformFeeBps,
  platformFeeMinCents: r.platformFeeMinCents,
  licensePriceCents: r.licensePriceCents,
  platformFeeCents: r.platformFeeCents,
  amountTotalCents: r.amountTotalCents,
  exclusive: r.exclusive,
  exclusiveMultiplierBps: r.exclusiveMultiplierBps,
});

/** `p` settled: null once it resolves, else what it threw, so a waiter or a race's loser never rejects unhandled. */
export const settled = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (error: unknown) => error,
  );
