import "server-only";
import type { Currency } from "@/lib/domain/values";
import { type Env, enabledCurrencies, env, isDevAppEnv } from "@/server/env";
import type { PaymentsDriver } from "./driver";
import { createFakeDriver } from "./fake-driver";

// One payments driver per currency (07 D95): each currency has its own Stripe platform account.

/** The connected-account country for each currency's platform account. */
export const CURRENCY_ACCOUNT_COUNTRY = {
  cad: "CA",
  usd: "US",
} as const satisfies Record<Currency, "CA" | "US">;

export class CurrencyNotEnabledError extends Error {
  constructor(currency: Currency) {
    super(`Currency ${currency} is not in ENABLED_CURRENCIES`);
    this.name = "CurrencyNotEnabledError";
  }
}

type RegistryEnv = Pick<
  Env,
  "APP_ENV" | "PAYMENTS_DRIVER" | "ENABLED_CURRENCIES"
>;

/** A memoized currency → driver lookup for `e` (the app's env in production code, an injected one in tests). */
export function createPaymentsRegistry(
  e: RegistryEnv,
): (currency: Currency) => PaymentsDriver {
  const drivers = new Map<Currency, PaymentsDriver>();
  return (currency) => {
    const known = drivers.get(currency);
    if (known) return known;
    if (!enabledCurrencies(e).includes(currency)) {
      throw new CurrencyNotEnabledError(currency);
    }
    if (e.PAYMENTS_DRIVER === "stripe") {
      throw new Error("Stripe driver arrives in P24");
    }
    if (!isDevAppEnv(e.APP_ENV)) {
      throw new Error(
        "The fake payments driver runs only when APP_ENV is development or test",
      );
    }
    const driver = createFakeDriver({ currency });
    drivers.set(currency, driver);
    return driver;
  };
}

let fromEnv: ((currency: Currency) => PaymentsDriver) | undefined;

/** The driver for `currency`'s platform account, by env.PAYMENTS_DRIVER; memoized per currency. */
export function paymentsDriver(currency: Currency): PaymentsDriver {
  fromEnv ??= createPaymentsRegistry(env);
  return fromEnv(currency);
}
