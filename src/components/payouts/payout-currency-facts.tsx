import { INLINE_LINK } from "@/components/ui/inline-link";
import type { Currency } from "@/lib/domain/values";
import { currencyLabel, PAYOUT_BANK_ACCOUNT } from "@/lib/money/currency";

/** "You'll get paid in Canadian dollars (CAD) to a Canadian bank account." (07 D94, D98), or the USD sentence. */
export function payoutCurrencyFact(currency: Currency): string {
  return `You'll get paid in ${currencyLabel(currency)} to ${PAYOUT_BANK_ACCOUNT[currency]}.`;
}

/**
 * The payout currency fact line and, under it, the negative-balance line with its "Payout terms" link (07 D94, D139;
 * DRAFT copy, 04 §11.10). The onboarding payouts step and Settings both render this, so they never differ. The link sits
 * inside the sentence as an inline link and opens the Terms in a new tab (05 §5.2 callout 27).
 */
export function PayoutCurrencyFacts({ currency }: { currency: Currency }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-callout text-ink-2">{payoutCurrencyFact(currency)}</p>
      <p className="text-footnote text-ink-2">
        If a refund ever takes back money you've already been paid and your
        Stripe balance goes below zero, Stripe may take that amount from your
        bank account.{" "}
        <a
          href="/legal/terms#payouts"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Payout terms (opens in a new tab)"
          className={INLINE_LINK}
        >
          Payout terms
        </a>
      </p>
    </div>
  );
}
