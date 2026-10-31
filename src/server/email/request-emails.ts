import "server-only";
import { eq } from "drizzle-orm";
import { createElement, type ReactElement } from "react";
import type { db, Tx } from "@/db/client";
import { creatorProfile, licenseRequest, user, video } from "@/db/schema";
import { RequestDeclined } from "@/emails/request-declined";
import { RequestNew } from "@/emails/request-new";
import { RequestReceived } from "@/emails/request-received";
import { scopeLabel } from "@/lib/licensing/selection";
import { requestDetailPath, requestStatusPath } from "@/lib/urls";
import { env } from "../env";
import { revealBuyerToken } from "../tokens/buyer-token";
import {
  requestDeclinedSubject,
  requestNewSubject,
  requestReceivedSubject,
} from "./subjects";

// The three request emails (05 §8): who gets each and its subject when it is queued, and its message when it is sent.
// Each reads the request as it is now (02 §5.10): email_log keeps only the recipient's hash. The creator's email never
// names the buyer's address (07 D47). Both switches cover every template, so a new one fails typecheck until it is
// handled in each.

export type RequestEmailTemplate =
  | "request-new"
  | "request-received"
  | "request-declined";

/**
 * What the request emails need, in one read: the request (with why it ended), its creator (address, zone, payouts) and
 * the video's title.
 */
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
      statusReason: licenseRequest.statusReason,
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

/** `template`'s recipient and subject: request-new goes to the creator, the others to the buyer. */
export function requestEnvelope(
  template: RequestEmailTemplate,
  f: RequestEmailFacts,
): { to: string; subject: string } {
  switch (template) {
    case "request-new":
      return {
        to: f.creatorEmail,
        subject: requestNewSubject(f.licenseeName, f.title),
      };
    case "request-received":
      return { to: f.buyerEmail, subject: requestReceivedSubject(f.handle) };
    case "request-declined":
      return { to: f.buyerEmail, subject: requestDeclinedSubject() };
    default:
      throw new Error(`No request email ${template satisfies never}`);
  }
}

/**
 * `template`'s recipient and message for request `requestId`, built now; null when the request is gone, or has no
 * deadline for the two emails that print it. The buyer's link carries the key, revealed only now (revealBuyerToken
 * throws TokenCipherError when the sealed copy can't be opened).
 */
export async function composeRequestEmail(
  executor: typeof db,
  template: RequestEmailTemplate,
  requestId: string,
): Promise<{ to: string; element: ReactElement } | null> {
  const f = await requestEmailFacts(executor, requestId);
  if (!f) return null;
  const { to } = requestEnvelope(template, f);
  const scope = scopeLabel(f);
  switch (template) {
    case "request-new":
      if (!f.expiresAt) return null;
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
    case "request-received":
      if (!f.expiresAt) return null;
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
    case "request-declined":
      return {
        to,
        element: createElement(RequestDeclined, {
          handle: f.handle,
          title: f.title,
          scope,
          statusReason: f.statusReason,
          url: `${env.APP_URL}${requestStatusPath(f.id, revealBuyerToken(f))}`,
        }),
      };
    default:
      throw new Error(`No request email ${template satisfies never}`);
  }
}
