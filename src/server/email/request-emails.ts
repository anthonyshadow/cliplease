import "server-only";
import { eq } from "drizzle-orm";
import { createElement, type ReactElement } from "react";
import type { db, Tx } from "@/db/client";
import { creatorProfile, licenseRequest, user, video } from "@/db/schema";
import { RequestNew } from "@/emails/request-new";
import { RequestReceived } from "@/emails/request-received";
import { scopeLabel } from "@/lib/licensing/selection";
import { requestDetailPath, requestStatusPath } from "@/lib/urls";
import { env } from "../env";
import { revealBuyerToken } from "../tokens/buyer-token";
import { requestNewSubject, requestReceivedSubject } from "./subjects";

// The two request emails (05 §8): who gets each and its subject when it is queued, and its message when it is sent. Both
// read the request as it is now (02 §5.10): email_log keeps only the recipient's hash. The creator's email never names
// the buyer's address (07 D47).

export type RequestEmailTemplate = "request-new" | "request-received";

/** What both emails need, in one read: the request, its creator (address, zone, payouts) and the video's title. */
export async function requestEmailFacts(
  executor: typeof db | Tx,
  requestId: string,
) {
  const [facts] = await executor
    .select({
      id: licenseRequest.id,
      buyerEmail: licenseRequest.buyerEmail,
      buyerTimeZone: licenseRequest.buyerTimeZone,
      buyerTokenEnc: licenseRequest.buyerTokenEnc,
      licenseeName: licenseRequest.licenseeName,
      useKey: licenseRequest.useKey,
      termKey: licenseRequest.termKey,
      territoryKey: licenseRequest.territoryKey,
      territoryCode: licenseRequest.territoryCode,
      licensePriceCents: licenseRequest.licensePriceCents,
      amountTotalCents: licenseRequest.amountTotalCents,
      currency: licenseRequest.currency,
      expiresAt: licenseRequest.expiresAt,
      creatorEmail: user.email,
      creatorTimeZone: creatorProfile.timeZone,
      payoutsStatus: creatorProfile.payoutsStatus,
      handle: creatorProfile.handle,
      title: video.title,
    })
    .from(licenseRequest)
    .innerJoin(creatorProfile, eq(creatorProfile.id, licenseRequest.creatorId))
    .innerJoin(user, eq(user.id, creatorProfile.userId))
    .innerJoin(video, eq(video.id, licenseRequest.videoId))
    .where(eq(licenseRequest.id, requestId));
  return facts ?? null;
}

export type RequestEmailFacts = NonNullable<
  Awaited<ReturnType<typeof requestEmailFacts>>
>;

/** `template`'s recipient and subject. */
export function requestEnvelope(
  template: RequestEmailTemplate,
  f: RequestEmailFacts,
): { to: string; subject: string } {
  return template === "request-new"
    ? {
        to: f.creatorEmail,
        subject: requestNewSubject(f.licenseeName, f.title),
      }
    : { to: f.buyerEmail, subject: requestReceivedSubject(f.handle) };
}

/**
 * `template`'s recipient and message for request `requestId`, built now; null when the request is gone. The buyer's link
 * carries the key (revealBuyerToken throws TokenCipherError when the sealed copy can't be opened).
 */
export async function composeRequestEmail(
  executor: typeof db,
  template: RequestEmailTemplate,
  requestId: string,
): Promise<{ to: string; element: ReactElement } | null> {
  const f = await requestEmailFacts(executor, requestId);
  if (!f?.expiresAt) return null;
  const { to } = requestEnvelope(template, f);
  const scope = scopeLabel(f);
  if (template === "request-new") {
    return {
      to,
      element: createElement(RequestNew, {
        licenseeName: f.licenseeName,
        title: f.title,
        scope,
        licensePriceCents: f.licensePriceCents,
        currency: f.currency,
        expiresAt: f.expiresAt,
        timeZone: f.creatorTimeZone,
        payoutsActive: f.payoutsStatus === "active",
        url: `${env.APP_URL}${requestDetailPath(f.id)}`,
      }),
    };
  }
  return {
    to,
    element: createElement(RequestReceived, {
      handle: f.handle,
      title: f.title,
      scope,
      amountTotalCents: f.amountTotalCents,
      currency: f.currency,
      expiresAt: f.expiresAt,
      timeZone: f.buyerTimeZone,
      url: `${env.APP_URL}${requestStatusPath(f.id, revealBuyerToken(f))}`,
    }),
  };
}
