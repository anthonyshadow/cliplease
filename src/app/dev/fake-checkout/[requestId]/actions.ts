"use server";

import { notFound, redirect } from "next/navigation";
import { openFakeCheckout } from "@/server/payments/fake-checkout";

// The fake checkout's buttons (02 §6.1; 05 §10): each returns where Stripe's would. They exist in every build, so each
// runs openFakeCheckout's guard first. The key is rebuilt on the server, never passed in (owner answer Q-118 a). Pay and
// Let it expire arrive in P16b.

/** Cancel: Stripe's cancel_url, `/r/{id}?t={token}&checkout=canceled` (05 §4.2). Changes nothing. */
export async function fakeCheckoutCancel(requestId: string): Promise<void> {
  const checkout = await openFakeCheckout(String(requestId));
  if (!checkout) notFound();
  redirect(checkout.returnPath({ checkout: "canceled" }));
}
