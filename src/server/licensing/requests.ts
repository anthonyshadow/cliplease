import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { creatorProfile, licenseRequest, video } from "@/db/schema";
import type { LicenseRequest } from "@/db/schema/types";
import type { SocialProviderId } from "@/lib/domain/values";
import {
  chosenMultipliers,
  feeTerms,
  scopeLabel,
} from "@/lib/licensing/selection";
import type { LicenseRequestEvent } from "@/lib/licensing/transitions";
import {
  approvalWindowOf,
  computeExpiresAt,
  HOLD_TOO_SHORT_MS,
} from "@/lib/payments/expires-at";
import { computeQuote } from "@/lib/pricing/compute-quote";
import type { StartCheckoutInput } from "@/lib/validation/checkout";
import { normalizeEmail } from "@/lib/validation/email";
import { normalizeTimeZone } from "@/lib/validation/time-zone";
import { writeAudit } from "../audit";
import type { Actor } from "../auth/actor";
import { enabledCurrencies, env } from "../env";
import { errorName, logEvent } from "../log";
import {
  type CancelReason,
  cancel,
  createCheckout,
  getAuthorization,
  retrieveCheckout,
} from "../payments";
import {
  type Authorization,
  CHECKOUT_SESSION_TTL_MINUTES,
} from "../payments/driver";
import { CurrencyNotEnabledError } from "../payments/registry";
import {
  effectiveOptions,
  getRateCard,
  videoPricingOf,
} from "../pricing/rate-card";
import type { RequestContext } from "../request-context";
import { enabledPlatforms } from "../social/registry";
import { findRequestForBuyer, generateBuyerToken } from "../tokens/buyer-token";
import {
  isPubliclyAvailable,
  postingPlatformsColumn,
} from "../videos/visibility";
import { authorizationMismatches } from "./authorization";
import { runEffects } from "./effects";
import {
  applyTransition,
  ignoredEvent,
  type TransitionResult,
  unchangedResult,
} from "./state-machine";

// A buyer's license request (02 §5.7, §8.1, §8.3; 03 §5.1 T1–T3; 06 §6; 07 D24, D27, D31, D32, D74, D79, D81, D82,
// D84, D94, D95): priced by the server, saved once per form submission, handed to Checkout, then authorized when the
// card is held. Payouts are not checked: buyers can pay before the creator sets them up (07 D74). The video lock and
// availability check (07 D110) arrive with P19f, whose tables they read (owner answer Q-122 a); until then
// markAuthorized re-checks that the video is published. Statuses change only through applyTransition.

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

/**
 * T2 or T3 (02 §8.1 row 1; 03 T2, T3; 07 D27, D28, D32): a request in checkout whose card is held becomes
 * awaiting_approval, or abandoned when the hold, the video or the time it leaves is wrong. Stripe is read first, the
 * decision is one short transaction; after the commit its emails are sent (after the response) or the abandoned hold is
 * released. Anything else changes
 * nothing: another status (a webhook's late or second event is audited), no session or PaymentIntent, a session of
 * another request, a PaymentIntent not held. `platforms`: the enabled social platforms (tests pass their own).
 */
export async function markAuthorized(
  requestId: string,
  actor: Actor,
  platforms: readonly SocialProviderId[] = enabledPlatforms(),
): Promise<TransitionResult> {
  const [row] = await db
    .select()
    .from(licenseRequest)
    .where(eq(licenseRequest.id, requestId));
  if (!row) throw new Error("markAuthorized: unknown request");
  const unchanged = unchangedResult(row);
  if (row.status !== "checkout_pending") {
    if (actor.kind === "system" && actor.source === "webhook") {
      await writeAudit(
        db,
        actor,
        ignoredEvent(row.id, row.status, "authorized"),
      );
    }
    return unchanged;
  }
  if (!row.stripeCheckoutSessionId) return unchanged;
  const session = await retrieveCheckout(
    row.currency,
    row.stripeCheckoutSessionId,
  );
  if (session.requestId !== row.id || !session.paymentIntentId) {
    return unchanged;
  }
  const auth = await getAuthorization(row.currency, session.paymentIntentId);
  if (auth.status === "succeeded") {
    // Charged before any approval (07 D32): recorded only, until P18 and P25 reconcile it (owner answer Q-123 a).
    await writeAudit(
      db,
      actor,
      ignoredEvent(row.id, row.status, "authorized", { piStatus: auth.status }),
    );
    return unchanged;
  }
  if (auth.status !== "requires_capture") return unchanged;
  const { result, reason } = await decideAuthorization(
    row,
    auth,
    session.currency,
    actor,
    platforms,
  );
  runEffects(result.effects);
  if (result.changed && reason) await releaseHold(result.row, reason, actor);
  return result;
}

/** Why a held card is let go before approval (07 D27): each is the abandon event, its status_reason and the cancel's. */
type AbandonReason = Extract<CancelReason, LicenseRequestEvent>;

/**
 * After an abandon commits (07 D24, D27): cancels the hold, keyed by the attempt that abandon counted, so a retry sends
 * the same key. A cancel that fails (a thrown call comes back as transient: Stripe may or may not have canceled it) is
 * audited; the hold then lapses at capture_before, uncharged.
 */
async function releaseHold(
  row: LicenseRequest,
  reason: AbandonReason,
  actor: Actor,
): Promise<void> {
  if (!row.stripePaymentIntentId) return;
  const outcome = await cancel(
    row.currency,
    row.id,
    row.stripePaymentIntentId,
    reason,
    row.stripeAttempt,
  );
  if (outcome.ok) return;
  await writeAudit(db, actor, {
    action: "license_request.cancel_failed",
    entityType: "license_request",
    entityId: row.id,
    data: { reason, kind: outcome.kind, code: outcome.code },
  });
}

/**
 * The buyer is back from Checkout (02 §8.3), maybe before the webhook: with their own link and the session it stored,
 * once Stripe calls that session complete (owner answer Q-119 a) and the card is held, markAuthorized runs as the
 * webhook's would. Anything else changes nothing, and the page shows the stored status.
 */
export async function reconcileCheckoutReturn(
  requestId: string,
  token: string,
  sessionId: string,
): Promise<void> {
  const row = await findRequestForBuyer(requestId, token);
  if (
    row?.status !== "checkout_pending" ||
    row.stripeCheckoutSessionId !== sessionId
  ) {
    return;
  }
  const session = await retrieveCheckout(row.currency, sessionId);
  if (
    session.status !== "complete" ||
    session.requestId !== row.id ||
    !session.paymentIntentId
  ) {
    return;
  }
  const auth = await getAuthorization(row.currency, session.paymentIntentId);
  if (auth.status !== "requires_capture") return;
  await markAuthorized(row.id, { kind: "system", source: "return_url" });
}

/** The video can still be licensed (07 D27): published, and not hidden by a mock posting (07 D51). */
async function videoAvailable(
  tx: Tx,
  videoId: string,
  platforms: readonly SocialProviderId[],
): Promise<boolean> {
  const [row] = await tx
    .select({ status: video.status, postingPlatforms: postingPlatformsColumn })
    .from(video)
    .where(eq(video.id, videoId));
  return row !== undefined && isPubliclyAvailable(row, platforms);
}

/**
 * T2 or T3 in one short transaction (02 §8.1 row 1; 07 D32, D81): the asserts, then the video, then the hold's length:
 * at least an hour to approve (03 T2), from the request's own window. The first that fails abandons the request,
 * naming the asserts that failed; all passing authorizes it. P19f locks the video here, before applyTransition.
 */
async function decideAuthorization(
  row: LicenseRequest,
  auth: Authorization,
  sessionCurrency: string | null,
  actor: Actor,
  platforms: readonly SocialProviderId[],
): Promise<{ result: TransitionResult; reason: AbandonReason | null }> {
  const mismatches = authorizationMismatches(row, auth, sessionCurrency);
  const now = new Date();
  // The deadline counts from the instant stored as authorized_at.
  const authorizedAt = auth.authorizedAt ?? now;
  const expiresAt = computeExpiresAt({
    authorizedAt,
    captureBefore: auth.captureBefore,
    approvalWindowHours: approvalWindowOf(row.approvalWindowHours),
  });
  const ids = {
    stripePaymentIntentId: auth.paymentIntentId,
    stripeChargeId: auth.chargeId,
  };
  return db.transaction(async (tx) => {
    let reason: AbandonReason | null = null;
    if (mismatches.length > 0) reason = "amount_mismatch";
    else if (!(await videoAvailable(tx, row.videoId, platforms))) {
      reason = "video_unavailable";
    } else if (expiresAt.getTime() < now.getTime() + HOLD_TOO_SHORT_MS) {
      reason = "hold_too_short";
    }
    if (!reason) {
      const patch = {
        ...ids,
        authorizedAt,
        captureBefore: auth.captureBefore,
        expiresAt,
      };
      const result = await applyTransition(
        tx,
        row.id,
        "authorized",
        patch,
        actor,
      );
      return { result, reason };
    }
    const patch = {
      ...ids,
      abandonedAt: now,
      statusReason: reason,
      incrementStripeAttempt: true,
    };
    const result = await applyTransition(tx, row.id, reason, patch, actor);
    if (result.changed && mismatches.length > 0) {
      await writeAudit(tx, actor, {
        action: "license_request.amount_mismatch",
        entityType: "license_request",
        entityId: row.id,
        data: { fields: mismatches },
      });
    }
    return { result, reason };
  });
}
