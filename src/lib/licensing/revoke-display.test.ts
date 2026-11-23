import { describe, expect, it } from "vitest";
import {
  LICENSE_REVOKED_REASONS,
  MONEY_MOVEMENT_STATUSES,
  type MoneyMovementStatus,
  type RevokedReason,
} from "../domain/values";
import type { RecordStatus } from "./license-record";
import {
  adminLicenseMoney,
  creatorLicenseStatusLabel,
  type MoneyMovementCell,
  type MoneyPart,
  type MoneyRetry,
  revokedBuyerLine,
} from "./revoke-display";

const REVOKED_AT = new Date("2026-11-20T09:15:00.000Z");
const DATE = "20 Nov 2026, 09:15 UTC";
/** J4.7's amounts (07 D99): the buyer's total and the creator's share. */
const TOTAL = 173_250;
const PRICE = 157_500;

/** Every status a movement can have, or none at all. */
const EVERY_STATUS: readonly (MoneyMovementStatus | null)[] = [
  null,
  ...MONEY_MOVEMENT_STATUSES,
];

describe("revokedBuyerLine (01 J9.6; 03 §7.6; owner answer Q-209)", () => {
  it.each([false, true])(
    "reads the refund only once it succeeded (refunded: %s)",
    (refunded) => {
      const line = revokedBuyerLine({
        revokedAt: REVOKED_AT,
        refunded,
        totalCents: TOTAL,
        currency: "cad",
      });
      expect(line).toBe(
        refunded
          ? `Revoked on ${DATE}. You were refunded CA$1,732.50.`
          : `Revoked on ${DATE}.`,
      );
    },
  );

  it("prints the request's currency", () => {
    expect(
      revokedBuyerLine({
        revokedAt: REVOKED_AT,
        refunded: true,
        totalCents: 16_500,
        currency: "usd",
      }),
    ).toBe(`Revoked on ${DATE}. You were refunded US$165.00.`);
  });
});

describe("creatorLicenseStatusLabel (01 J9.8; 04 §9.9)", () => {
  const STATUSES: readonly RecordStatus[] = ["valid", "expired", "revoked"];
  const PLAIN = {
    valid: { label: "Valid", tone: "cleared" },
    expired: { label: "Expired", tone: "neutral" },
    revoked: { label: "Revoked", tone: "danger" },
  } as const;

  for (const status of STATUSES) {
    it.each([false, true])(`a ${status} license, refunded: %s`, (refunded) => {
      expect(creatorLicenseStatusLabel({ status, refunded })).toEqual(
        status === "revoked" && refunded
          ? { label: "Revoked · refunded", tone: "danger" }
          : PLAIN[status],
      );
    });
  }
});

const ID = {
  creator_transfer: "00000000-0000-4000-8000-0000000000a1",
  buyer_refund: "00000000-0000-4000-8000-0000000000a2",
  transfer_reversal: "00000000-0000-4000-8000-0000000000a3",
} as const;

/** A movement of `kind` at `status`, or none. */
function movement(
  kind: keyof typeof ID,
  status: MoneyMovementStatus | null,
  amountCents: number,
): MoneyMovementCell | null {
  if (status === null) return null;
  return {
    id: ID[kind],
    status,
    amountCents,
    lastError: status === "failed" ? "insufficient_funds" : null,
  };
}

const transferOf = (s: MoneyMovementStatus | null) =>
  movement("creator_transfer", s, PRICE);
const refundOf = (s: MoneyMovementStatus | null) =>
  movement("buyer_refund", s, TOTAL);
const reversalOf = (s: MoneyMovementStatus | null) =>
  movement("transfer_reversal", s, PRICE);

const retryOf = (kind: keyof typeof ID, amountCents: number): MoneyRetry => ({
  movementId: ID[kind],
  amountCents,
});

/** A part of `kind` that moved or waits: no Retry. */
const done = (kind: keyof typeof ID, text: string): MoneyPart => ({
  kind,
  text,
  retry: null,
});

const transferPart = (text: string) => done("creator_transfer", text);
const refundPart = (text: string) => done("buyer_refund", text);
const takeBackPart = (text: string) => done("transfer_reversal", text);

/** A failed movement's part, with its Retry. */
const failedPart = (
  text: string,
  kind: keyof typeof ID,
  amountCents: number,
): MoneyPart => ({
  kind,
  text,
  retry: retryOf(kind, amountCents),
});

/** The Money cell's words, part by part. */
const textsOf = (parts: readonly MoneyPart[] | null | undefined) =>
  parts?.map((p) => p.text);

describe("adminLicenseMoney, a license that isn't revoked (05 §7 callout 7; owner answers Q-199 a, Q-209)", () => {
  /** P21's transfer words; Retry only on a failed one; nothing for none or a canceled one. */
  const TRANSFER: Record<string, MoneyPart | null> = {
    null: null,
    succeeded: transferPart("Transfer CA$1,575.00 sent"),
    pending: transferPart("Transfer pending"),
    failed: failedPart(
      "Transfer failed (insufficient_funds)",
      "creator_transfer",
      PRICE,
    ),
    canceled: null,
  };

  for (const transfer of EVERY_STATUS) {
    it.each(EVERY_STATUS)(
      `transfer ${transfer}: its words whatever the refund (%s) and take-back rows say`,
      (other) => {
        const money = adminLicenseMoney({
          revokedReason: null,
          currency: "cad",
          transfer: transferOf(transfer),
          refund: refundOf(other),
          reversal: reversalOf(other),
        });
        const part = TRANSFER[String(transfer)];
        expect(money).toEqual(part ? [part] : null);
      },
    );
  }
});

describe("adminLicenseMoney, a revoked license (05 §7 callouts 8, 9; 07 D86; owner answer Q-209)", () => {
  /** The refund part by its buyer_refund (none: only Payment reversed's line). */
  function expectedRefund(
    status: MoneyMovementStatus | null,
    reason: RevokedReason,
  ): MoneyPart | null {
    switch (status) {
      case "succeeded":
        return refundPart("Refunded CA$1,732.50");
      case "pending":
        return refundPart("Refund pending");
      case "failed":
        return failedPart("Refund failed", "buyer_refund", TOTAL);
      default:
        return reason === "payment_reversed"
          ? refundPart("No refund (money already returned)")
          : null;
    }
  }

  /**
   * The take-back part by its transfer_reversal (canceled: it found the canceled payout never landed, Q-210), else by
   * the creator transfer: a canceled one, or nothing to take back or cancel.
   */
  function expectedTakeBack(
    reversal: MoneyMovementStatus | null,
    transfer: MoneyMovementStatus | null,
  ): MoneyPart {
    switch (reversal) {
      case "succeeded":
        return takeBackPart("Taken back CA$1,575.00");
      case "pending":
        return takeBackPart("Take-back pending");
      case "failed":
        return failedPart("Take-back failed", "transfer_reversal", PRICE);
      case "canceled":
        return takeBackPart("Payout canceled");
      default:
        return takeBackPart(
          transfer === "canceled" ? "Payout canceled" : "Nothing to take back",
        );
    }
  }

  it("reads D99's sentence after a revoke that refunded and took back", () => {
    expect(
      adminLicenseMoney({
        revokedReason: "issued_in_error",
        currency: "cad",
        transfer: transferOf("succeeded"),
        refund: refundOf("succeeded"),
        reversal: reversalOf("succeeded"),
      }),
    ).toEqual([
      refundPart("Refunded CA$1,732.50"),
      takeBackPart("Taken back CA$1,575.00"),
    ]);
  });

  it("reads Payout canceled for a canceled payout, its take-back's or the revoke's, and Nothing to take back with neither (Q-210)", () => {
    const takeBack = (
      transfer: MoneyMovementStatus | null,
      reversal: MoneyMovementStatus | null,
    ) =>
      adminLicenseMoney({
        revokedReason: "rights_claim",
        currency: "cad",
        transfer: transferOf(transfer),
        refund: refundOf("succeeded"),
        reversal: reversalOf(reversal),
      })?.at(-1);
    // A call was made before the revoke canceled it: the take-back found nothing landed.
    expect(takeBack("canceled", "canceled")).toEqual(
      takeBackPart("Payout canceled"),
    );
    // No call was ever made: the revoke wrote no take-back.
    expect(takeBack("canceled", null)).toEqual(takeBackPart("Payout canceled"));
    expect(takeBack(null, null)).toEqual(takeBackPart("Nothing to take back"));
  });

  it("gives each failed part its own Retry; a part that went through has none", () => {
    const both = adminLicenseMoney({
      revokedReason: "rights_claim",
      currency: "cad",
      transfer: transferOf("succeeded"),
      refund: refundOf("failed"),
      reversal: reversalOf("failed"),
    });
    expect(textsOf(both)).toEqual(["Refund failed", "Take-back failed"]);
    expect(both?.map((p) => p.retry)).toEqual([
      retryOf("buyer_refund", TOTAL),
      retryOf("transfer_reversal", PRICE),
    ]);
    const one = adminLicenseMoney({
      revokedReason: "rights_claim",
      currency: "cad",
      transfer: transferOf("succeeded"),
      refund: refundOf("succeeded"),
      reversal: reversalOf("failed"),
    });
    expect(one?.map((p) => p.retry)).toEqual([
      null,
      retryOf("transfer_reversal", PRICE),
    ]);
  });

  it("prints each amount as its movement holds it, in the request's currency", () => {
    expect(
      textsOf(
        adminLicenseMoney({
          revokedReason: "licensee_breach",
          currency: "usd",
          transfer: transferOf("succeeded"),
          refund: refundOf("succeeded"),
          reversal: movement("transfer_reversal", "succeeded", 90_000),
        }),
      ),
    ).toEqual(["Refunded US$1,732.50", "Taken back US$900.00"]);
  });

  for (const reason of LICENSE_REVOKED_REASONS) {
    for (const refund of EVERY_STATUS) {
      for (const reversal of EVERY_STATUS) {
        it.each(EVERY_STATUS)(
          `${reason}, buyer_refund ${refund}, transfer_reversal ${reversal}, creator_transfer %s`,
          (transfer) => {
            const parts = [
              expectedRefund(refund, reason),
              expectedTakeBack(reversal, transfer),
            ].filter((p): p is MoneyPart => p !== null);
            expect(
              adminLicenseMoney({
                revokedReason: reason,
                currency: "cad",
                transfer: transferOf(transfer),
                refund: refundOf(refund),
                reversal: reversalOf(reversal),
              }),
            ).toEqual(parts);
          },
        );
      }
    }
  }
});
