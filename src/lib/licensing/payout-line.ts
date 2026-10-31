import type { Currency, MoneyMovementStatus } from "@/lib/domain/values";
import { formatMoney } from "@/lib/format";

// The creator's payout line under an approved request (04 §9.11, §11.5; 05 §6.3 callout 12; 07 D75; owner answer
// Q-146 a): what its creator transfer did. The words carry the meaning; the tone only colors them. Pure.

export const PAYOUT_LINE_COPY = {
  paidOut: "Paid out",
  pending: "Payout pending",
  /** The failed line, and the transfer Banner's sentence with the sum of the failed transfers (04 §9.21). */
  failed: (amount: string) => `Finish your payout setup to receive ${amount}.`,
} as const;

/**
 * The line for a request's creator transfer: Paid out (cleared), Payout pending (neutral), or the failed sentence with
 * its amount (awaiting). None without a transfer, or for a canceled one (P21b owns the revoke copy).
 */
export function payoutLine(
  t: {
    status: MoneyMovementStatus;
    amountCents: number;
    currency: Currency;
  } | null,
): { text: string; tone: "cleared" | "neutral" | "awaiting" } | null {
  if (!t) return null;
  switch (t.status) {
    case "succeeded":
      return { text: PAYOUT_LINE_COPY.paidOut, tone: "cleared" };
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
