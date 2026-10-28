import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { licenseRequest, video } from "@/db/schema";
import type { Currency, LicenseRequestStatus } from "@/lib/domain/values";
import { scopeLabel } from "@/lib/licensing/selection";
import { requestStatusPath } from "@/lib/urls";
import { isUuid } from "@/lib/validation/uuid";
import { type Env, env, isDevAppEnv } from "../env";
import { revealBuyerToken } from "../tokens/buyer-token";

// The dev fake checkout, /dev/fake-checkout/[requestId] (05 §10 S28; 02 §6.1; 07 D35): the fake driver's checkout URL.
// It answers only with PAYMENTS_DRIVER=fake and APP_ENV development or test (07 D51), never by NODE_ENV: e2e runs
// `next build && next start`. Stripe keeps a session's success and cancel URLs, which carry the buyer's key; the
// stateless fake driver can't, so this module rebuilds them from the row's sealed copy (owner answer Q-118 a). The page
// and its actions reach a request only through openFakeCheckout, behind the guard.

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
  title: string;
  scope: string;
  currency: Currency;
  licensePriceCents: number;
  platformFeeCents: number;
  amountTotalCents: number;
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
      currency: licenseRequest.currency,
      licensePriceCents: licenseRequest.licensePriceCents,
      platformFeeCents: licenseRequest.platformFeeCents,
      amountTotalCents: licenseRequest.amountTotalCents,
      title: video.title,
    })
    .from(licenseRequest)
    .innerJoin(video, eq(video.id, licenseRequest.videoId))
    .where(eq(licenseRequest.id, requestId));
  if (!row?.sessionId) return null;
  const token = revealBuyerToken(row);
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    scope: scopeLabel(row),
    currency: row.currency,
    licensePriceCents: row.licensePriceCents,
    platformFeeCents: row.platformFeeCents,
    amountTotalCents: row.amountTotalCents,
    returnPath: (extra) => requestStatusPath(row.id, token, extra),
  };
}
