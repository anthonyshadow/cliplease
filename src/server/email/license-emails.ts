import "server-only";
import { eq } from "drizzle-orm";
import { createElement, type ReactElement } from "react";
import type { db } from "@/db/client";
import { license, licenseRequest } from "@/db/schema";
import { LicenseApproved } from "@/emails/license-approved";
import { scopeLabel } from "@/lib/licensing/selection";
import { licensePath, verifyPath } from "@/lib/urls";
import { env } from "../env";
import { revealBuyerToken } from "../tokens/buyer-token";

// The emails a license sends (05 §8; 07 D34): license-approved, to the buyer. The state machine's T5 queues it after
// the license is issued (its subject names the code); the outbox composes it when it is sent, from the request and the
// license as they are then. The amounts come from the license's snapshot, which holds the request's.

/** The request and its license, in one read; null before the license exists. */
async function licenseEmailFacts(executor: typeof db, requestId: string) {
  const [facts] = await executor
    .select({
      id: licenseRequest.id,
      buyerEmail: licenseRequest.buyerEmail,
      buyerTokenEnc: licenseRequest.buyerTokenEnc,
      useKey: licenseRequest.useKey,
      termKey: licenseRequest.termKey,
      territoryKey: licenseRequest.territoryKey,
      territoryCode: licenseRequest.territoryCode,
      code: license.code,
      snapshot: license.snapshot,
    })
    .from(licenseRequest)
    .innerJoin(license, eq(license.licenseRequestId, licenseRequest.id))
    .where(eq(licenseRequest.id, requestId));
  return facts ?? null;
}

/**
 * license-approved's recipient and message for request `requestId`, built now; null when it has no license. The /l
 * link carries the request's buyer key (revealBuyerToken throws TokenCipherError when the sealed copy can't be opened).
 */
export async function composeLicenseApprovedEmail(
  executor: typeof db,
  requestId: string,
): Promise<{ to: string; element: ReactElement } | null> {
  const f = await licenseEmailFacts(executor, requestId);
  if (!f) return null;
  const token = revealBuyerToken(f);
  const { snapshot: s } = f;
  return {
    to: f.buyerEmail,
    element: createElement(LicenseApproved, {
      handle: s.creator.handle,
      title: s.video.title,
      scope: scopeLabel(f),
      code: f.code,
      amountTotalCents: s.amounts.amountTotalCents,
      currency: s.amounts.currency,
      url: `${env.APP_URL}${licensePath(token)}`,
      verifyUrl: `${env.APP_URL}${verifyPath(f.code)}`,
    }),
  };
}
