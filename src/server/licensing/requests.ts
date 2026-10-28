import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { creatorProfile, licenseRequest, video } from "@/db/schema";
import type { LicenseRequest } from "@/db/schema/types";
import type { SocialProviderId } from "@/lib/domain/values";
import {
  chosenMultipliers,
  feeTerms,
  scopeLabel,
} from "@/lib/licensing/selection";
import { computeQuote } from "@/lib/pricing/compute-quote";
import type { StartCheckoutInput } from "@/lib/validation/checkout";
import { normalizeEmail } from "@/lib/validation/email";
import { normalizeTimeZone } from "@/lib/validation/time-zone";
import { writeAudit } from "../audit";
import { enabledCurrencies, env } from "../env";
import { errorName, logEvent } from "../log";
import { createCheckout, retrieveCheckout } from "../payments";
import { CHECKOUT_SESSION_TTL_MINUTES } from "../payments/driver";
import { CurrencyNotEnabledError } from "../payments/registry";
import {
  effectiveOptions,
  getRateCard,
  videoPricingOf,
} from "../pricing/rate-card";
import type { RequestContext } from "../request-context";
import { enabledPlatforms } from "../social/registry";
import { generateBuyerToken } from "../tokens/buyer-token";
import {
  isPubliclyAvailable,
  postingPlatformsColumn,
} from "../videos/visibility";

// A buyer's license request (02 §5.7; 03 §5.1 T1; 06 §6; 07 D24, D31, D74, D79, D81, D82, D84, D94, D95): priced by the
// server, saved once per form submission, then handed to Checkout. Payouts are not checked: buyers can pay before the
// creator sets them up (07 D74). The video lock and availability check (07 D110) arrive with P19f, whose tables they
// read (owner answer Q-122 a); until then P16b re-checks that the video is published when the hold is authorized. No
// status ever changes here: the state machine is P16b's.

export type CreateLicenseRequestResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; reason: "price_changed"; totalCents: number }
  | {
      ok: false;
      reason:
        | "not_available"
        | "option_disabled"
        | "over_max"
        | "checkout_failed"
        | "already_submitted";
    };

/** The row as createLicenseRequest builds it; the transaction adds the creator's settings and the two timestamps. */
type NewRequest = Omit<
  typeof licenseRequest.$inferInsert,
  | "approvalWindowHours"
  | "autoApprove"
  | "termsAcceptedAt"
  | "checkoutExpiresAt"
>;

/**
 * The request for `i` (the parsed StartCheckoutSchema), checked against the video and its creator's rate card, or why
 * not. A `submissionId` makes one row: sending it again returns that request's open Checkout, unless anything the
 * buyer entered changed. `platforms`: the enabled social platforms (tests pass their own).
 */
export async function createLicenseRequest(
  i: StartCheckoutInput,
  ctx: RequestContext,
  platforms: readonly SocialProviderId[] = enabledPlatforms(),
): Promise<CreateLicenseRequestResult> {
  const [row] = await db
    .select({
      id: video.id,
      creatorId: video.creatorId,
      title: video.title,
      status: video.status,
      disabledUses: video.disabledUses,
      basePriceOverrideCents: video.basePriceOverrideCents,
      postingPlatforms: postingPlatformsColumn,
    })
    .from(video)
    .where(eq(video.id, i.videoId));
  if (!row || !isPubliclyAvailable(row, platforms)) {
    return { ok: false, reason: "not_available" };
  }
  const options = effectiveOptions(
    await getRateCard(row.creatorId),
    videoPricingOf(row),
  );
  const multipliers = chosenMultipliers(options, {
    use: i.useKey,
    term: i.termKey,
    territory: i.territoryKey,
    territoryCode: i.territoryCode,
  });
  if (!multipliers) return { ok: false, reason: "option_disabled" };
  const { currency } = options;
  const fees = feeTerms(options, env.PLATFORM_FEE_BPS);
  const result = computeQuote({
    currency,
    basePriceCents: options.basePriceCents,
    ...multipliers,
    ...fees,
  });
  if (!result.ok) {
    if (result.reason === "over_max") return { ok: false, reason: "over_max" };
    throw new Error("License request: the quote's input is out of range");
  }
  const { quote } = result;
  if (quote.totalCents !== i.expectedTotalCents) {
    return { ok: false, reason: "price_changed", totalCents: quote.totalCents };
  }
  // Before the row: a currency without its platform account must not leave a request behind (06 §6).
  if (!enabledCurrencies().includes(currency)) {
    throw new CurrencyNotEnabledError(currency);
  }

  const id = randomUUID();
  const token = generateBuyerToken(id);
  const buyerEmail = normalizeEmail(i.buyerEmail);
  const values: NewRequest = {
    id,
    videoId: row.id,
    creatorId: row.creatorId,
    licenseeName: i.licenseeName,
    contactName: i.contactName,
    buyerEmail,
    intendedUse: i.intendedUse || null,
    buyerTimeZone: normalizeTimeZone(i.timeZone),
    buyerTokenHash: token.hash,
    buyerTokenEnc: token.enc,
    useKey: i.useKey,
    termKey: i.termKey,
    territoryKey: i.territoryKey,
    territoryCode: i.territoryCode,
    currency,
    basePriceCents: options.basePriceCents,
    useMultiplierBps: multipliers.useBps,
    termMultiplierBps: multipliers.termBps,
    territoryMultiplierBps: multipliers.territoryBps,
    ...fees,
    licensePriceCents: quote.licensePriceCents,
    platformFeeCents: quote.platformFeeCents,
    amountTotalCents: quote.totalCents,
    termsVersion: i.termsVersion,
    termsAcceptedIp: ctx.ip,
    termsAcceptedUserAgent: ctx.userAgent,
    checkoutSubmissionId: i.submissionId,
  };
  const saved = await saveRequest(values);
  if (saved.kind === "existing") return resubmitted(saved.request, values);

  // After the commit, never inside it (07 D24).
  let session: { sessionId: string; url: string };
  try {
    session = await createCheckout(currency, {
      currency,
      requestId: id,
      buyerToken: token.token,
      buyerEmail,
      licensePriceCents: quote.licensePriceCents,
      platformFeeCents: quote.platformFeeCents,
      licenseLabel: `${row.title} · ${scopeLabel(i)}`,
      checkoutExpiresAt: saved.checkoutExpiresAt,
    });
  } catch (error) {
    // The row stays checkout_pending with no session; [H4]'s sweep abandons it (07 D57).
    logEvent("warn", "license_request.checkout_failed", {
      requestId: id,
      error: errorName(error),
    });
    return { ok: false, reason: "checkout_failed" };
  }
  const [stored] = await db
    .update(licenseRequest)
    .set({ stripeCheckoutSessionId: session.sessionId })
    .where(
      and(
        eq(licenseRequest.id, id),
        isNull(licenseRequest.stripeCheckoutSessionId),
      ),
    )
    .returning({ id: licenseRequest.id });
  if (!stored) return { ok: false, reason: "checkout_failed" };
  return { ok: true, checkoutUrl: session.url };
}

/**
 * The insert (T1), in one short transaction: the creator's row FOR SHARE, so the currency, the approval window and
 * auto-approve are the ones in force (07 D81, D94, I33), then the row, or nothing when the submission already has one,
 * and its audit. Nothing here calls the payments driver.
 */
async function saveRequest(
  values: NewRequest,
): Promise<
  | { kind: "created"; checkoutExpiresAt: Date }
  | { kind: "existing"; request: LicenseRequest }
> {
  return db.transaction(async (tx) => {
    const [creator] = await tx
      .select({
        payoutCurrency: creatorProfile.payoutCurrency,
        approvalWindowHours: creatorProfile.approvalWindowHours,
        autoApprove: creatorProfile.autoApprove,
      })
      .from(creatorProfile)
      .where(eq(creatorProfile.id, values.creatorId))
      .for("share");
    if (creator?.payoutCurrency !== values.currency) {
      // Priced in another currency than the creator's now: not possible before P34 lets a creator change it.
      throw new Error("License request: the creator's currency changed");
    }
    const [inserted] = await tx
      .insert(licenseRequest)
      .values({
        ...values,
        approvalWindowHours: creator.approvalWindowHours,
        autoApprove: creator.autoApprove,
        termsAcceptedAt: sql`now()`,
        checkoutExpiresAt: sql`now() + make_interval(mins => ${CHECKOUT_SESSION_TTL_MINUTES}::int)`,
      })
      .onConflictDoNothing({ target: licenseRequest.checkoutSubmissionId })
      .returning({
        id: licenseRequest.id,
        checkoutExpiresAt: licenseRequest.checkoutExpiresAt,
      });
    if (inserted) {
      await writeAudit(
        tx,
        { kind: "buyer", requestId: inserted.id },
        {
          action: "license_request.created",
          entityType: "license_request",
          entityId: inserted.id,
          data: { videoId: values.videoId, creatorId: values.creatorId },
        },
      );
      return { kind: "created", checkoutExpiresAt: inserted.checkoutExpiresAt };
    }
    const [request] = await tx
      .select()
      .from(licenseRequest)
      .where(
        eq(licenseRequest.checkoutSubmissionId, values.checkoutSubmissionId),
      );
    if (!request)
      throw new Error("License request: the conflicting row is gone");
    return { kind: "existing", request };
  });
}

/** What a resubmit is compared on (07 D31, J7.9; owner answer Q-120 a: the names and the use too). */
const RESUBMIT_KEYS = [
  "videoId",
  "buyerEmail",
  "licenseeName",
  "contactName",
  "intendedUse",
  "useKey",
  "termKey",
  "territoryKey",
  "territoryCode",
] as const;

/**
 * The same submission again (a double tap, Back, a retry): its open Checkout when the buyer entered the same things and
 * it is still in checkout (07 D31, J7.9), else "already sent". A Checkout that can't be read throws, so the page keeps
 * the submission and a retry reads it again: a fresh one could open a second Checkout beside the first.
 */
async function resubmitted(
  request: LicenseRequest,
  sent: NewRequest,
): Promise<CreateLicenseRequestResult> {
  const same =
    request.status === "checkout_pending" &&
    RESUBMIT_KEYS.every((key) => request[key] === sent[key]);
  if (!same || !request.stripeCheckoutSessionId) {
    return { ok: false, reason: "already_submitted" };
  }
  const session = await retrieveCheckout(
    request.currency,
    request.stripeCheckoutSessionId,
  );
  return session.status === "open" && session.url
    ? { ok: true, checkoutUrl: session.url }
    : { ok: false, reason: "already_submitted" };
}
