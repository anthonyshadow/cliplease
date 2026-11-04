// A demo request's way through the domain, for the [int] tests that follow one after a price change (P19d, P19e): the
// request as the action parses it, T2, the creator's Approve and what the request stores. Apart from
// video-price-fixtures.ts, whose Server Action tests don't load the licensing server code. Tests only.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
import type { RequestContext } from "../../src/server/request-context";
import { DEMO_REQUEST } from "./checkout-fixtures";
import { requestRow } from "./factories";

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
