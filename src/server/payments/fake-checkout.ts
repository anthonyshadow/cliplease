import "server-only";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { creatorProfile, licenseRequest, video } from "@/db/schema";
import type { Currency, LicenseRequestStatus } from "@/lib/domain/values";
import { licenseLineLabel, scopeLabel } from "@/lib/licensing/selection";
import { requestStatusPath, videoUrl } from "@/lib/urls";
import { isUuid } from "@/lib/validation/uuid";
import { type Env, env, isDevAppEnv } from "../env";
import { revealBuyerToken } from "../tokens/buyer-token";
import type { PaymentsEvent } from "./driver";
import { onWebhookEvent } from "./events";

// The dev fake checkout, /dev/fake-checkout/[requestId] (05 §10 S28; 02 §6.1; 07 D35): the fake driver's checkout URL.
// It answers only with PAYMENTS_DRIVER=fake and APP_ENV development or test (07 D51), never by NODE_ENV: e2e runs
// `next build && next start`. Stripe keeps a session's success and cancel URLs, which carry the buyer's key; the
// stateless fake driver can't, so this module rebuilds them from the row's sealed copy (owner answer Q-118 a). The page
// and its actions reach a request only through openFakeCheckout, behind the guard. Pay and Let it expire send the events
// Stripe would, through the webhook's own path (07 D35).

/** The fake checkout serves only the fake driver in development and test. */
export function isFakeCheckoutEnabled(
  e: Pick<Env, "APP_ENV" | "PAYMENTS_DRIVER">,
): boolean {
  return e.PAYMENTS_DRIVER === "fake" && isDevAppEnv(e.APP_ENV);
}

/** What the page shows: the request's own snapshot, never a new quote. */
export type FakeCheckout = {
  id: string;
  status: LicenseRequestStatus;
  /** The session the request stored: `cs_fake_<id>`. */
  sessionId: string;
  title: string;
  scope: string;
  exclusive: boolean;
  /** 07 D113's line item: what an exclusive request shows in place of `scope`. */
  label: string;
  currency: Currency;
  licensePriceCents: number;
  platformFeeCents: number;
  amountTotalCents: number;
  /** The unpaid hold's end (owner answer Q-170), its session's end, and the database's clock for the page's countdown. */
  holdUntil: Date;
  sessionEndsAt: Date;
  now: Date;
  /** The video's license page. */
  licensePath: string;
  /** The buyer's /r link plus `extra`, where Stripe would return them. Only for redirect(): never shown or logged. */
  returnPath: (extra?: Readonly<Record<string, string>>) => string;
};

/**
 * The request behind a fake checkout URL, or null for a 404: the guard is off, the id unknown, or the request has no
 * session (createCheckout threw, so its URL was never handed out). Throws TokenCipherError for a row sealed under
 * another TOKEN_ENCRYPTION_KEY.
 */
export async function openFakeCheckout(
  requestId: string,
): Promise<FakeCheckout | null> {
  if (!isFakeCheckoutEnabled(env) || !isUuid(requestId)) return null;
  const [row] = await db
    .select({
      id: licenseRequest.id,
      status: licenseRequest.status,
      buyerTokenEnc: licenseRequest.buyerTokenEnc,
      sessionId: licenseRequest.stripeCheckoutSessionId,
      useKey: licenseRequest.useKey,
      termKey: licenseRequest.termKey,
      territoryKey: licenseRequest.territoryKey,
      territoryCode: licenseRequest.territoryCode,
      exclusive: licenseRequest.exclusive,
      currency: licenseRequest.currency,
      licensePriceCents: licenseRequest.licensePriceCents,
      platformFeeCents: licenseRequest.platformFeeCents,
      amountTotalCents: licenseRequest.amountTotalCents,
      holdUntil: licenseRequest.checkoutHoldUntil,
      sessionEndsAt: licenseRequest.checkoutExpiresAt,
      now: sql<Date>`now()`.mapWith(licenseRequest.checkoutExpiresAt),
      title: video.title,
      slug: video.slug,
      handle: creatorProfile.handle,
    })
    .from(licenseRequest)
    .innerJoin(video, eq(video.id, licenseRequest.videoId))
    .innerJoin(creatorProfile, eq(creatorProfile.id, video.creatorId))
    .where(eq(licenseRequest.id, requestId));
  if (!row?.sessionId) return null;
  const token = revealBuyerToken(row);
  const scope = scopeLabel(row);
  return {
    id: row.id,
    status: row.status,
    sessionId: row.sessionId,
    title: row.title,
    scope,
    exclusive: row.exclusive,
    label: licenseLineLabel({
      title: row.title,
      scopeLabel: scope,
      exclusive: row.exclusive,
    }),
    currency: row.currency,
    licensePriceCents: row.licensePriceCents,
    platformFeeCents: row.platformFeeCents,
    amountTotalCents: row.amountTotalCents,
    holdUntil: row.holdUntil,
    sessionEndsAt: row.sessionEndsAt,
    now: row.now,
    licensePath: videoUrl(row.handle, row.slug),
    returnPath: (extra) => requestStatusPath(row.id, token, extra),
  };
}

/** A new fake event's id and origin: test mode, from this app. */
const fakeEventBase = () => ({
  id: `evt_fake_${randomUUID()}`,
  livemode: false,
  appUrl: env.APP_URL,
});

/** Pay: the buyer paid, so Stripe reports the session completed (02 §5.8), from the request's own account. */
export async function payFakeCheckout(checkout: FakeCheckout): Promise<void> {
  const event: PaymentsEvent = {
    ...fakeEventBase(),
    type: "checkout.session.completed",
    sessionId: checkout.sessionId,
    requestId: checkout.id,
    paymentIntentId: `pi_fake_${checkout.id}`,
  };
  await onWebhookEvent(event, checkout.currency);
}

/** Let it expire: the session ended unpaid (02 §5.8). */
export async function expireFakeCheckout(
  checkout: FakeCheckout,
): Promise<void> {
  const event: PaymentsEvent = {
    ...fakeEventBase(),
    type: "checkout.session.expired",
    sessionId: checkout.sessionId,
    requestId: checkout.id,
  };
  await onWebhookEvent(event, checkout.currency);
}
