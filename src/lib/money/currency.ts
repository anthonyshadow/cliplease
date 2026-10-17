// Client-safe currency display data (07 D98, §8.2). Imports only the Currency type.
import type { Currency } from "../domain/values";

export const CURRENCY_DISPLAY = {
  cad: { code: "CAD", prefix: "CA$", name: "Canadian dollars" },
  usd: { code: "USD", prefix: "US$", name: "US dollars" },
} as const satisfies Record<
  Currency,
  { code: string; prefix: string; name: string }
>;

/** "Canadian dollars (CAD)" · "US dollars (USD)". */
export function currencyLabel(c: Currency): string {
  const { name, code } = CURRENCY_DISPLAY[c];
  return `${name} (${code})`;
}
