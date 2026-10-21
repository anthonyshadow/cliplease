import "server-only";
import type { Currency } from "@/lib/domain/values";
import type { PaymentsDriver } from "./driver";

const notYet = (method: string, prompt: string) => async (): Promise<never> => {
  throw new Error(`fake driver: ${method} arrives in ${prompt}`);
};

/**
 * The stateless fake (07 D35, D95) for development and test, in either currency. Payouts: the account id is derived from
 * the creator id, setup returns straight to Settings and payouts are always on. Checkout and money movements arrive with
 * P16 (checkout and authorizations), P19b (transfers) and P21b (refunds and reversals). `appUrl` is the app's origin,
 * as the Stripe driver takes it.
 */
export function createFakeDriver({
  currency,
  appUrl,
}: {
  currency: Currency;
  appUrl: string;
}): PaymentsDriver {
  return {
    name: "fake",
    currency,
    async createConnectedAccount({ id }) {
      return `acct_fake_${id}`;
    },
    async enableNegativeBalanceDebits() {
      return { ok: true };
    },
    async createOnboardingLink() {
      return `${appUrl}/dashboard/settings?payouts=returned`;
    },
    async fetchPayoutsStatus() {
      return { status: "active", payoutsActive: true, needsInfo: false };
    },
    createCheckout: notYet("createCheckout", "P16"),
    retrieveCheckout: notYet("retrieveCheckout", "P16"),
    getAuthorization: notYet("getAuthorization", "P16"),
    capture: notYet("capture", "P16"),
    cancel: notYet("cancel", "P16"),
    createTransfer: notYet("createTransfer", "P19b"),
    findTransfers: notYet("findTransfers", "P19b"),
    refund: notYet("refund", "P21b"),
    reverseTransfer: notYet("reverseTransfer", "P21b"),
    async parseWebhook() {
      // Webhooks come only from Stripe; the fake never accepts one (02 §5.8).
      throw new Error("fake driver: webhooks are Stripe-only");
    },
  };
}
