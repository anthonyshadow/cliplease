"use server";

import { notFound, redirect } from "next/navigation";
import {
  expireFakeCheckout,
  openFakeCheckout,
  payFakeCheckout,
} from "@/server/payments/fake-checkout";

// The fake checkout's buttons (02 §5.8, §6.1; 05 §10; 07 D35): each does what Stripe's would, then returns where Stripe
// sends the buyer. They exist in every build, so each runs openFakeCheckout's guard first. The key is rebuilt on the
// server, never passed in (owner answer Q-118 a). A request past checkout only goes to its /r page.

/** Pay: the completed event, then Stripe's success_url, `/r/{id}?t={token}&session_id={CHECKOUT_SESSION_ID}`. */
export async function fakeCheckoutPay(requestId: string): Promise<void> {
  const checkout = await openFakeCheckout(String(requestId));
  if (!checkout) notFound();
  if (checkout.status !== "checkout_pending") redirect(checkout.returnPath());
  await payFakeCheckout(checkout);
  redirect(checkout.returnPath({ session_id: checkout.sessionId }));
}

/** Cancel: Stripe's cancel_url, `/r/{id}?t={token}&checkout=canceled` (05 §4.2). Changes nothing. */
export async function fakeCheckoutCancel(requestId: string): Promise<void> {
  const checkout = await openFakeCheckout(String(requestId));
  if (!checkout) notFound();
  redirect(checkout.returnPath({ checkout: "canceled" }));
}

/** Let it expire: the expired event, then the buyer's link, as if they opened it again later. */
export async function fakeCheckoutExpire(requestId: string): Promise<void> {
  const checkout = await openFakeCheckout(String(requestId));
  if (!checkout) notFound();
  if (checkout.status === "checkout_pending")
    await expireFakeCheckout(checkout);
  redirect(checkout.returnPath());
}
