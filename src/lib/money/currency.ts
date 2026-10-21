// Client-safe currency display data (07 D98, §8.2). Imports only the Currency type.
import type { Currency } from "../domain/values";

export const CURRENCY_DISPLAY = {
  cad: { code: "CAD", prefix: "CA$", name: "Canadian dollars" },
  usd: { code: "USD", prefix: "US$", name: "US dollars" },
} as const satisfies Record<
  Currency,
  { code: string; prefix: string; name: string }
>;

/** Where each currency's payouts go, for the fact line: USD is for creators with a US bank account (07 D140, owner). */
export const PAYOUT_BANK_ACCOUNT = {
  cad: "a Canadian bank account",
  usd: "a US bank account",
} as const satisfies Record<Currency, string>;

/** "Canadian dollars (CAD)" · "US dollars (USD)". */
export function currencyLabel(c: Currency): string {
  const { name, code } = CURRENCY_DISPLAY[c];
  return `${name} (${code})`;
}
