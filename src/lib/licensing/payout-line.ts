import type { Currency, MoneyMovementStatus } from "@/lib/domain/values";
import { formatMoney } from "@/lib/format";

// The creator's payout line under an approved request (04 §9.11, §11.5; 05 §6.3 callout 12; 07 D75, D86; owner
// answers Q-146 a, Q-209): what its creator transfer did, and whether a revoke took it back. The words carry the
// meaning; the tone only colors them. Pure.

export const PAYOUT_LINE_COPY = {
  paidOut: "Paid out",
  /** A revoke's take-back of a sent payout went through (owner answer Q-209). */
  takenBack: "Taken back",
  pending: "Payout pending",
  /** The failed line, and the transfer Banner's sentence with the sum of the failed transfers (04 §9.21). */
  failed: (amount: string) => `Finish your payout setup to receive ${amount}.`,
} as const;

/**
 * The line for a request's creator transfer: Paid out (cleared), or Taken back (neutral) once a revoke took it back
 * (`takenBack`: its transfer_reversal succeeded); Payout pending (neutral); or the failed sentence with its amount
 * (awaiting). None without a transfer, or for a canceled one (a revoke canceled it before it was sent).
 */
export function payoutLine(
  t: {
    status: MoneyMovementStatus;
    amountCents: number;
    currency: Currency;
    takenBack: boolean;
  } | null,
): { text: string; tone: "cleared" | "neutral" | "awaiting" } | null {
  if (!t) return null;
  switch (t.status) {
    case "succeeded":
      return t.takenBack
        ? { text: PAYOUT_LINE_COPY.takenBack, tone: "neutral" }
        : { text: PAYOUT_LINE_COPY.paidOut, tone: "cleared" };
    case "pending":
      return { text: PAYOUT_LINE_COPY.pending, tone: "neutral" };
    case "failed":
      return {
        text: PAYOUT_LINE_COPY.failed(formatMoney(t.amountCents, t.currency)),
        tone: "awaiting",
      };
    case "canceled":
      return null;
  }
}
