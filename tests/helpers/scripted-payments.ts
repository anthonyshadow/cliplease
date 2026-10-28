import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { licenseRequest } from "../../src/db/schema";
import type {
  Currency,
  LicenseRequestStatus,
} from "../../src/lib/domain/values";
import { env } from "../../src/server/env";
import type {
  Authorization,
  PaymentsDriver,
  StripeCallOutcome,
} from "../../src/server/payments/driver";
import { createFakeDriver } from "../../src/server/payments/fake-driver";

// A payments double for [int] tests (P16b; P19 adds capture and cancel outcome classes, onCall hooks and the D25
// matrix): the fake driver's answers (07 D35) unless a script says otherwise, and a log of every scripted method's
// call. Tests inject it by mocking src/server/payments/registry.ts, so paymentsDriver(currency) returns driverFor(it).
// Only tests import it: nothing in src may.

type Checkout = Awaited<ReturnType<PaymentsDriver["retrieveCheckout"]>>;

/** What the next calls answer, until changed: a partial is laid over the fake's answer; an Error is thrown. */
export type PaymentScripts = {
  retrieveCheckout?: Partial<Checkout> | Error;
  getAuthorization?: Partial<Authorization> | Error;
  cancel?: StripeCallOutcome | Error;
};

export type ScriptedCall = {
  method: "retrieveCheckout" | "getAuthorization" | "cancel";
  currency: Currency;
  args: readonly unknown[];
  /** The idempotency key, for a call that takes one. */
  key?: string;
  /** For a cancel: the request's committed status when it was called (07 D24: the abandon commits first). */
  status?: LicenseRequestStatus | null;
};

/** The request a `pi-cancel:<id>:…` key names. */
async function committedStatus(key: string) {
  const requestId = key.split(":")[1] ?? "";
  const [row] = await db
    .select({ status: licenseRequest.status })
    .from(licenseRequest)
    .where(eq(licenseRequest.id, requestId));
  return row?.status ?? null;
}

export function createScriptedPayments() {
  const scripts: PaymentScripts = {};
  const log: ScriptedCall[] = [];
  const drivers = new Map<Currency, PaymentsDriver>();

  /** The double on `currency`'s account; every currency shares the scripts and the log. */
  function driverFor(currency: Currency): PaymentsDriver {
    const known = drivers.get(currency);
    if (known) return known;
    const fake = createFakeDriver({ currency, appUrl: env.APP_URL });
    const driver: PaymentsDriver = {
      ...fake,
      async retrieveCheckout(sessionId) {
        log.push({ method: "retrieveCheckout", currency, args: [sessionId] });
        const script = scripts.retrieveCheckout;
        if (script instanceof Error) throw script;
        return { ...(await fake.retrieveCheckout(sessionId)), ...script };
      },
      async getAuthorization(paymentIntentId) {
        log.push({
          method: "getAuthorization",
          currency,
          args: [paymentIntentId],
        });
        const script = scripts.getAuthorization;
        if (script instanceof Error) throw script;
        return { ...(await fake.getAuthorization(paymentIntentId)), ...script };
      },
      async cancel(paymentIntentId, reason, key) {
        log.push({
          method: "cancel",
          currency,
          args: [paymentIntentId, reason, key],
          key,
          status: await committedStatus(key),
        });
        const script = scripts.cancel;
        if (script instanceof Error) throw script;
        return script ?? fake.cancel(paymentIntentId, reason, key);
      },
    };
    drivers.set(currency, driver);
    return driver;
  }

  return {
    driverFor,
    log,
    /** The calls of one method, in order. */
    callsOf: (method: ScriptedCall["method"]) =>
      log.filter((call) => call.method === method),
    /** Sets what the next calls answer (merged over the scripts so far; `undefined` drops one). */
    script(next: PaymentScripts) {
      Object.assign(scripts, next);
    },
  };
}

export type ScriptedPayments = ReturnType<typeof createScriptedPayments>;
