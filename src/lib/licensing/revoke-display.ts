// What a revoked license's money reads like to each side (01 A.5, A.8, J9.6, J9.8; 03 §7.6, §7.8, §7.9; 05 §7
// callouts 7–9; 07 D86; owner answers Q-199 a, Q-209): the buyer's revoked line, the creator's status pill, and the
// admin's Money cell with the movements a Retry can send again. Pure and client-safe; amounts only through formatMoney,
// dates in UTC.
import { MONEY_COPY } from "../admin/copy";
import { transferLabel } from "../admin/labels";
import type {
  Currency,
  MoneyMovementKind,
  MoneyMovementStatus,
  RevokedReason,
} from "../domain/values";
import { formatLicenseDate, formatMoney } from "../format";
import {
  LICENSE_RECORD_COPY,
  licenseStatusPill,
  type RecordStatus,
} from "./license-record";

/**
 * The line that replaces a revoked license's downloads (01 J9.6; 03 §7.6): "Revoked on {date}. You were refunded
 * {total}." once the buyer_refund succeeded (`refunded`), else "Revoked on {date}." (pending, failed, or none: Payment
 * reversed).
 */
export function revokedBuyerLine(r: {
  revokedAt: Date;
  refunded: boolean;
  totalCents: number;
  currency: Currency;
}): string {
  const date = formatLicenseDate(r.revokedAt);
  const copy = LICENSE_RECORD_COPY.buyer;
  return r.refunded
    ? copy.revokedRefunded(date, formatMoney(r.totalCents, r.currency))
    : copy.revokedOn(date);
}

/**
 * The creator's status pill (01 J9.8; 04 §9.9): «Revoked · refunded» in danger once a revoked license's buyer was
 * refunded, else licenseStatusPill's Valid / Expired / Revoked.
 */
export function creatorLicenseStatusLabel(l: {
  status: RecordStatus;
  refunded: boolean;
}): ReturnType<typeof licenseStatusPill> {
  if (l.status === "revoked" && l.refunded) {
    return {
      label: LICENSE_RECORD_COPY.dashboard.revokedRefunded,
      tone: "danger",
    };
  }
  return licenseStatusPill(l.status);
}

/** One of a license's money movements as the admin's Money cell reads it: never its Stripe id. */
export type MoneyMovementCell = {
  id: string;
  status: MoneyMovementStatus;
  amountCents: number;
  /** A Stripe error code only. */
  lastError: string | null;
};

/** The failed movement a part's Retry sends again: its id and amount (its kind is the part's). */
export type MoneyRetry = {
  movementId: string;
  amountCents: number;
};

/**
 * One part of the Money cell: the movement it reads (its kind: the part's React key, which stays while its words
 * change, and its Retry's name and words), its words, and the Retry that follows them when its movement failed. Only a
 * part with a Retry reads in danger: "Refunded CA$1,732.50" stays neutral beside "Take-back failed".
 */
export type MoneyPart = {
  kind: MoneyMovementKind;
  text: string;
  retry: MoneyRetry | null;
};

/** A part that moved or waits: nothing to retry. */
const done = (kind: MoneyMovementKind, text: string): MoneyPart => ({
  kind,
  text,
  retry: null,
});

/** A failed movement's part, with its Retry. */
const failed = (
  kind: MoneyMovementKind,
  text: string,
  m: MoneyMovementCell,
): MoneyPart => ({
  kind,
  text,
  retry: { movementId: m.id, amountCents: m.amountCents },
});

/** The refund part (05 §7 callouts 8, 9): its buyer_refund, or Payment reversed's none; nothing otherwise. */
function refundPart(
  refund: MoneyMovementCell | null,
  revokedReason: RevokedReason,
  currency: Currency,
): MoneyPart | null {
  const kind = "buyer_refund";
  switch (refund?.status) {
    case "succeeded":
      return done(
        kind,
        MONEY_COPY.refunded(formatMoney(refund.amountCents, currency)),
      );
    case "pending":
      return done(kind, MONEY_COPY.refundPending);
    case "failed":
      return failed(kind, MONEY_COPY.refundFailed, refund);
    default:
      // The revoke writes a refund for every other reason, in its own transaction.
      return revokedReason === "payment_reversed"
        ? done(kind, MONEY_COPY.noRefund)
        : null;
  }
}

/**
 * The take-back part (07 D86; owner answer Q-210): its transfer_reversal, "Payout canceled" once it found the canceled
 * payout never landed; with none, "Payout canceled" when the revoke canceled a transfer no call was made for, else
 * "Nothing to take back" (no transfer to take back or cancel).
 */
function takeBackPart(
  reversal: MoneyMovementCell | null,
  transfer: Pick<MoneyMovementCell, "status"> | null,
  currency: Currency,
): MoneyPart {
  const kind = "transfer_reversal";
  switch (reversal?.status) {
    case "succeeded":
      return done(
        kind,
        MONEY_COPY.takenBack(formatMoney(reversal.amountCents, currency)),
      );
    case "pending":
      return done(kind, MONEY_COPY.takeBackPending);
    case "failed":
      return failed(kind, MONEY_COPY.takeBackFailed, reversal);
    case "canceled":
      return done(kind, MONEY_COPY.payoutCanceled);
    default:
      return done(
        kind,
        transfer?.status === "canceled"
          ? MONEY_COPY.payoutCanceled
          : MONEY_COPY.nothingToTakeBack,
      );
  }
}

/**
 * The Licenses tab's Money cell (05 §7 callouts 7–9; owner answer Q-209), its parts joined with " · " where it prints
 * them, every amount in the request's `currency` (I33): a license that isn't revoked reads its transfer as
 * transferLabel does ("Transfer {price} sent", with Retry when it failed), or null with no transfer to show; a revoked
 * one reads its refund part, then its take-back part ("Refunded CA$1,732.50 · Taken back CA$1,575.00"), each amount the
 * movement's own and each with its own Retry, since both can fail. `revokedReason` is null while not revoked.
 */
export function adminLicenseMoney(l: {
  revokedReason: RevokedReason | null;
  currency: Currency;
  transfer: MoneyMovementCell | null;
  refund: MoneyMovementCell | null;
  reversal: MoneyMovementCell | null;
}): MoneyPart[] | null {
  const parts: MoneyPart[] = [];
  if (l.revokedReason === null) {
    const text = transferLabel(
      l.transfer && { ...l.transfer, currency: l.currency },
    );
    if (l.transfer && text) {
      parts.push(
        l.transfer.status === "failed"
          ? failed("creator_transfer", text, l.transfer)
          : done("creator_transfer", text),
      );
    }
  } else {
    const refund = refundPart(l.refund, l.revokedReason, l.currency);
    if (refund) parts.push(refund);
    parts.push(takeBackPart(l.reversal, l.transfer, l.currency));
  }
  return parts.length > 0 ? parts : null;
}
