import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { creatorProfile, licenseRequest, moneyMovement } from "@/db/schema";
import type { Currency, MoneyMovementKind } from "@/lib/domain/values";
import { DAY_MS } from "@/lib/time";
import { isUuid } from "@/lib/validation/uuid";
import type {
  Authorization,
  FoundTransfer,
  PaymentsDriver,
  PiStatus,
} from "./driver";
import { transferGroupFor } from "./keys";

/** A card hold lasts 7 days (07 D35). */
const HOLD_MS = 7 * DAY_MS;

const FAKE_ID = /^(cs|pi)_fake_(.+)$/;

/** The request behind a fake id (`cs_fake_<id>`, `pi_fake_<id>`); anything else throws before any query. */
function requestIdOf(kind: "cs" | "pi", fakeId: string): string {
  const match = FAKE_ID.exec(fakeId);
  const requestId = match?.[2];
  if (match?.[1] !== kind || !requestId || !isUuid(requestId)) {
    throw new Error(`fake driver: unknown ${kind}_fake id`);
  }
  return requestId;
}

/**
 * What the fake reads of a request: everything it reports is derived from the row, never stored. Like Stripe, an account
 * knows only its own: another currency's request is unknown here (07 D95).
 */
async function requestRow(requestId: string, currency: Currency) {
  const [row] = await db
    .select({
      id: licenseRequest.id,
      status: licenseRequest.status,
      currency: licenseRequest.currency,
      amountTotalCents: licenseRequest.amountTotalCents,
      paymentIntentId: licenseRequest.stripePaymentIntentId,
      authorizedAt: licenseRequest.authorizedAt,
    })
    .from(licenseRequest)
    .where(eq(licenseRequest.id, requestId));
  if (!row) throw new Error("fake driver: unknown request");
  if (row.currency !== currency) {
    throw new Error(
      `fake driver: a ${row.currency} request on the ${currency} account`,
    );
  }
  return row;
}

type RequestRow = Awaited<ReturnType<typeof requestRow>>;

/**
 * What a revoke gave back on the request (07 D35, D86), as Stripe would report it: the amount of its `kind` row once that
 * row succeeded, and the fake id `prefix` + the request id when that amount is > 0 (owner answer Q-206).
 */
async function returned(
  requestId: string,
  kind: Extract<MoneyMovementKind, "buyer_refund" | "transfer_reversal">,
  prefix: "re_fake_" | "trr_fake_",
): Promise<{ cents: number; id: string | null }> {
  const [row] = await db
    .select({ amountCents: moneyMovement.amountCents })
    .from(moneyMovement)
    .where(
      and(
        eq(moneyMovement.licenseRequestId, requestId),
        eq(moneyMovement.kind, kind),
        eq(moneyMovement.status, "succeeded"),
      ),
    );
  const cents = row?.amountCents ?? 0;
  return { cents, id: cents > 0 ? `${prefix}${requestId}` : null };
}

/**
 * The request's transfers as Stripe would list them (02 §5.8): the creator_transfer row once it has recorded a transfer,
 * to the creator's account, reversed by the transfer_reversal row once that succeeded.
 */
async function transfersOf(requestId: string): Promise<FoundTransfer[]> {
  const rows = await db
    .select({
      transferId: moneyMovement.stripeObjectId,
      amountCents: moneyMovement.amountCents,
      destinationAccountId: creatorProfile.stripeAccountId,
    })
    .from(moneyMovement)
    .innerJoin(
      licenseRequest,
      eq(licenseRequest.id, moneyMovement.licenseRequestId),
    )
    .innerJoin(creatorProfile, eq(creatorProfile.id, licenseRequest.creatorId))
    .where(
      and(
        eq(moneyMovement.licenseRequestId, requestId),
        eq(moneyMovement.kind, "creator_transfer"),
        isNotNull(moneyMovement.stripeObjectId),
      ),
    );
  const reversed = await returned(requestId, "transfer_reversal", "trr_fake_");
  return rows.flatMap(({ transferId, amountCents, destinationAccountId }) =>
    transferId && destinationAccountId
      ? [
          {
            transferId,
            amountCents,
            amountReversedCents: reversed.cents,
            reversalId: reversed.id,
            destinationAccountId,
          },
        ]
      : [],
  );
}

/**
 * The PaymentIntent a request's status stands for (07 D35). A request still in checkout reports a hold placed now (owner
 * answer Q-119 a): the fake Pay (P16b) authorizes through its event before the buyer comes back, and P16b's return path
 * accepts a session only once it is complete. A request that never got a hold, or a renewal row (P22e), has none.
 */
function piStatusOf(row: RequestRow): PiStatus {
  switch (row.status) {
    case "checkout_pending":
    case "awaiting_approval":
      return "requires_capture";
    case "approved":
      return "succeeded";
    case "declined":
    case "expired":
    case "capture_failed":
      return "canceled";
    case "abandoned":
      if (row.paymentIntentId) return "canceled";
      throw new Error("fake driver: this request never had a payment");
    case "renewal_pending":
    case "renewal_canceled":
    case "renewal_failed":
      throw new Error("fake driver: renewal payments arrive in P22e");
  }
}

/**
 * The stateless fake (07 D35, D95) for development and test, in either currency. Payouts: the account id is derived from
 * the creator id, setup returns straight to Settings and payouts are always on. Checkout: the session, the PaymentIntent
 * and the charge are `cs_fake_` / `pi_fake_` / `ch_fake_` + the request id, every answer derived from the request's row
 * (a platform charge on this currency's account: no destination, no application fee, 07 D74); capture and cancel always
 * succeed and send no event. A transfer is `tr_fake_` + the request id, read back from the creator_transfer row that
 * recorded it; a refund `re_fake_` and a reversal `trr_fake_` + the request id (07 D76), always succeeded, read back from
 * the buyer_refund and transfer_reversal rows once they succeeded (owner answer Q-206). `appUrl` is the app's origin, as
 * the Stripe driver takes it.
 */
export function createFakeDriver({
  currency,
  appUrl,
}: {
  currency: Currency;
  appUrl: string;
}): PaymentsDriver {
  const checkoutUrl = (requestId: string) =>
    `${appUrl}/dev/fake-checkout/${requestId}`;
  return {
    name: "fake",
    currency,
    async createConnectedAccount({ id }) {
      return `acct_fake_${id}`;
    },
    async enableNegativeBalanceDebits() {
      return { ok: true };
    },
    async createOnboardingLink(_accountId, opts) {
      const back = new URL(opts?.returnTo ?? "/dashboard/settings", appUrl);
      back.searchParams.set("payouts", "returned");
      return back.toString();
    },
    async fetchPayoutsStatus() {
      return { status: "active", payoutsActive: true, needsInfo: false };
    },
    // No key, email or token goes anywhere: the page reads the request itself (owner answer Q-118 a).
    async createCheckout(i) {
      if (i.currency !== currency) {
        throw new Error(
          `fake driver: a ${i.currency} checkout on the ${currency} account`,
        );
      }
      if (!isUuid(i.requestId)) throw new Error("fake driver: bad request id");
      return {
        sessionId: `cs_fake_${i.requestId}`,
        url: checkoutUrl(i.requestId),
      };
    },
    async retrieveCheckout(sessionId) {
      const row = await requestRow(requestIdOf("cs", sessionId), currency);
      // A stored PaymentIntent means the session completed, whatever happened next (02 §8.1).
      const status =
        row.status === "checkout_pending"
          ? "open"
          : row.paymentIntentId
            ? "complete"
            : "expired";
      return {
        sessionId,
        requestId: row.id,
        paymentIntentId: `pi_fake_${row.id}`,
        amountTotalCents: row.amountTotalCents,
        currency: row.currency,
        status,
        url: status === "open" ? checkoutUrl(row.id) : null,
      };
    },
    async getAuthorization(paymentIntentId): Promise<Authorization> {
      const row = await requestRow(
        requestIdOf("pi", paymentIntentId),
        currency,
      );
      const status = piStatusOf(row);
      const refunded = await returned(row.id, "buyer_refund", "re_fake_");
      const authorizedAt =
        row.status === "checkout_pending" ? new Date() : row.authorizedAt;
      return {
        paymentIntentId,
        status,
        amountCents: row.amountTotalCents,
        currency: row.currency,
        applicationFeeCents: null,
        destination: null,
        transferGroup: transferGroupFor(row.id),
        onBehalfOf: null,
        chargeId: `ch_fake_${row.id}`,
        riskLevel: "normal",
        amountRefundedCents: refunded.cents,
        refundId: refunded.id,
        captureMethod: "manual",
        metadataRequestId: row.id,
        authorizedAt,
        captureBefore: authorizedAt
          ? new Date(authorizedAt.getTime() + HOLD_MS)
          : null,
        requestId: row.id,
      };
    },
    async capture(paymentIntentId) {
      requestIdOf("pi", paymentIntentId);
      return { ok: true };
    },
    async cancel(paymentIntentId) {
      requestIdOf("pi", paymentIntentId);
      return { ok: true };
    },
    async createTransfer({ requestId }) {
      // Stateless (07 D35): the caller records the transfer on its money_movement row, which findTransfers reads back.
      if (!isUuid(requestId)) throw new Error("fake driver: not a request id");
      return { ok: true, transferId: `tr_fake_${requestId}` };
    },
    async findTransfers(requestId) {
      await requestRow(requestId, currency);
      return transfersOf(requestId);
    },
    async refund({ requestId, paymentIntentId }) {
      // The request's own PaymentIntent, on this account only (07 D95); the caller records the refund on its row.
      if (requestIdOf("pi", paymentIntentId) !== requestId) {
        throw new Error("fake driver: not the request's PaymentIntent");
      }
      await requestRow(requestId, currency);
      return {
        ok: true,
        refundId: `re_fake_${requestId}`,
        status: "succeeded",
      };
    },
    async reverseTransfer({ requestId }) {
      if (!isUuid(requestId)) throw new Error("fake driver: not a request id");
      await requestRow(requestId, currency);
      return { ok: true, reversalId: `trr_fake_${requestId}` };
    },
    async parseWebhook() {
      // Webhooks come only from Stripe; the fake never accepts one (02 §5.8).
      throw new Error("fake driver: webhooks are Stripe-only");
    },
  };
}
