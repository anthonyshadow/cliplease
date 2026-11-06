"use server";

import { notFound, redirect } from "next/navigation";
import type { ExtendHoldResult } from "@/lib/licensing/checkout-hold";
import type { ActionResult } from "@/lib/result";
import { retryEmailOutbox } from "@/server/email/send";
import { extendCheckoutHold } from "@/server/licensing/checkout-hold";
import { afterResponse } from "@/server/licensing/effects";
import {
  expireFakeCheckout,
  openFakeCheckout,
  payFakeCheckout,
} from "@/server/payments/fake-checkout";
import { redactErrors } from "@/server/rethrow-redacted";

// The fake checkout's buttons (02 §5.8, §6.1; 05 §10; 07 D35): each does what Stripe's would, then returns where Stripe
// sends the buyer. They exist in every build, so each runs openFakeCheckout's guard first. The key is rebuilt on the
// server, never passed in (owner answer Q-118 a). A request past checkout only goes to its /r page. Pay doesn't check the
// hold: T2 is the guard against a late payment.

/**
 * Pay: the completed event, then Stripe's success_url, `/r/{id}?t={token}&session_id={CHECKOUT_SESSION_ID}`. Like each
 * webhook delivery (02 §8.1), it then retries the email outbox after the response.
 */
export async function fakeCheckoutPay(requestId: string): Promise<void> {
  return redactErrors("fake_checkout.pay_failed", async () => {
    const checkout = await openFakeCheckout(String(requestId));
    if (!checkout) notFound();
    if (checkout.status !== "checkout_pending") {
      redirect(checkout.returnPath());
    }
    await payFakeCheckout(checkout);
    afterResponse(() => retryEmailOutbox({ limit: 20 }));
    redirect(checkout.returnPath({ session_id: checkout.sessionId }));
  });
}

/** Cancel: goes to Stripe's cancel_url, `/r/{id}?t={token}&checkout=canceled` (05 §4.2), where /r releases the hold. */
export async function fakeCheckoutCancel(requestId: string): Promise<void> {
  return redactErrors("fake_checkout.cancel_failed", async () => {
    const checkout = await openFakeCheckout(String(requestId));
    if (!checkout) notFound();
    redirect(checkout.returnPath({ checkout: "canceled" }));
  });
}

/** Let it expire: the expired event, then the buyer's link, as if they opened it again later. */
export async function fakeCheckoutExpire(requestId: string): Promise<void> {
  return redactErrors("fake_checkout.expire_failed", async () => {
    const checkout = await openFakeCheckout(String(requestId));
    if (!checkout) notFound();
    if (checkout.status === "checkout_pending") {
      await expireFakeCheckout(checkout);
    }
    redirect(checkout.returnPath());
  });
}

/** Extend: ten more minutes on the hold, or why not (owner answer Q-170). */
export async function fakeCheckoutExtend(
  requestId: string,
): Promise<ActionResult<ExtendHoldResult>> {
  return redactErrors("fake_checkout.extend_failed", async () => {
    const checkout = await openFakeCheckout(String(requestId));
    if (!checkout) notFound();
    return { ok: true, data: await extendCheckoutHold(checkout.id) };
  });
}
