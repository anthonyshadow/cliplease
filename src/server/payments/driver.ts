// The payments seam (02 §5.8, 07 §8.2): one driver per currency, so e2e runs the whole flow without Stripe (ADR-21).
// P05 declares what Phase A uses; the renewal methods, SavedCard, the renewal checkout fields and the
// payment_method.automatically_updated event arrive with P22c and P22e, CREATOR_FIXABLE_TRANSFER_CODES with P24.
import "server-only";
import type { Currency, PayoutsStatus } from "@/lib/domain/values";

export type PiStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "processing"
  | "requires_capture"
  | "succeeded"
  | "canceled";

export type Authorization = {
  paymentIntentId: string;
  status: PiStatus;
  amountCents: number;
  currency: string;
  applicationFeeCents: number | null; // asserted null under separate charges and transfers (07 D74, D76)
  destination: string | null;
  transferGroup: string | null; // asserted 'license-request:<id>'
  onBehalfOf: string | null;
  chargeId: string | null; // latest_charge: the transfer's source_transaction
  riskLevel:
    | "normal"
    | "elevated"
    | "highest"
    | "not_assessed"
    | "unknown"
    | null;
  amountRefundedCents: number;
  captureMethod: "manual" | "automatic" | "automatic_async";
  metadataRequestId: string | null;
  authorizedAt: Date | null;
  captureBefore: Date | null;
  requestId: string | null;
};

export type StripeCallOutcome =
  | { ok: true }
  | { ok: false; kind: "transient" | "permanent"; code: string };

export type MoneyCallFailure = {
  ok: false;
  kind: "transient" | "permanent";
  code: string;
};

export type CreateCheckoutInput = {
  currency: Currency; // = license_request.currency; must equal the driver's currency
  requestId: string;
  buyerToken: string;
  buyerEmail: string;
  licensePriceCents: number;
  platformFeeCents: number;
  licenseLabel: string;
  checkoutExpiresAt: Date;
};

export type PaymentsEvent = {
  id: string;
  livemode: boolean;
  appUrl: string | null;
} & (
  | {
      type: "checkout.session.completed";
      sessionId: string;
      requestId: string | null;
      paymentIntentId: string | null;
    }
  | {
      type: "checkout.session.expired";
      sessionId: string;
      requestId: string | null;
    }
  | {
      type:
        | "payment_intent.amount_capturable_updated"
        | "payment_intent.succeeded"
        | "payment_intent.canceled"
        | "payment_intent.payment_failed";
      paymentIntentId: string;
      requestId: string | null;
    }
  | { type: "ignored"; stripeType: string }
);

export interface PaymentsDriver {
  readonly name: "stripe" | "fake";
  /** The platform account this driver talks to (07 D95). */
  readonly currency: Currency;
  /** An individual 18+ account on this currency's platform account (07 D93, D95); the country comes from the currency. */
  createConnectedAccount(c: {
    id: string;
    email: string;
    displayName: string;
  }): Promise<string>;
  /** Lets Stripe debit the creator's bank account for a negative balance (07 D139, OQ-37). */
  enableNegativeBalanceDebits(
    accountId: string,
  ): Promise<{ ok: true } | MoneyCallFailure>;
  /**
   * The account's onboarding link. `returnTo` is a path already checked with returnToUrl (07 D37; owner answer Q-94):
   * where the creator comes back, with `payouts=returned` added; without one, /dashboard/settings?payouts=returned.
   */
  createOnboardingLink(
    accountId: string,
    opts?: { returnTo?: string },
  ): Promise<string>;
  fetchPayoutsStatus(accountId: string): Promise<{
    status: PayoutsStatus;
    payoutsActive: boolean;
    needsInfo: boolean;
  }>;
  createCheckout(
    i: CreateCheckoutInput,
  ): Promise<{ sessionId: string; url: string }>;
  retrieveCheckout(sessionId: string): Promise<{
    sessionId: string;
    requestId: string | null;
    paymentIntentId: string | null;
    amountTotalCents: number | null;
    currency: string | null;
    status: "open" | "complete" | "expired";
    url: string | null;
  }>;
  getAuthorization(paymentIntentId: string): Promise<Authorization>;
  capture(
    paymentIntentId: string,
    idempotencyKey: string,
  ): Promise<StripeCallOutcome>;
  cancel(
    paymentIntentId: string,
    reason: "requested_by_customer" | "abandoned",
    idempotencyKey: string,
  ): Promise<StripeCallOutcome>;
  createTransfer(i: {
    requestId: string;
    chargeId: string;
    destinationAccountId: string;
    amountCents: number;
    idempotencyKey: string;
  }): Promise<{ ok: true; transferId: string } | MoneyCallFailure>;
  findTransfers(requestId: string): Promise<
    Array<{
      transferId: string;
      amountCents: number;
      amountReversedCents: number;
      destinationAccountId: string;
    }>
  >;
  refund(i: {
    requestId: string;
    paymentIntentId: string;
    idempotencyKey: string;
  }): Promise<
    | { ok: true; refundId: string; status: "succeeded" | "pending" }
    | MoneyCallFailure
  >;
  reverseTransfer(i: {
    requestId: string;
    transferId: string;
    idempotencyKey: string;
  }): Promise<{ ok: true; reversalId: string } | MoneyCallFailure>;
  /** Async (07 D107). */
  parseWebhook(rawBody: string, signature: string): Promise<PaymentsEvent>;
}
