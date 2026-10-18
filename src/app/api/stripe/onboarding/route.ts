import { NextResponse } from "next/server";
import { signInPath } from "@/lib/sign-in";
import { getCreatorContext, getSessionUser } from "@/server/auth/session";
import { refreshPayoutsStatus } from "@/server/creators/profile";
import { ensureConnectedAccount } from "@/server/payments/connect";
import { paymentsDriver } from "@/server/payments/registry";

// "Set up payouts" (02 §6.2, 07 D35, D95): create the connected account on the payout currency's platform account if
// needed, then send the creator to its onboarding link (Stripe from P24; the fake returns straight to Settings). Every
// creator is 18+ (07 D93). P24 revisits the refresh-before-link order for real Stripe.
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.redirect(
      new URL(signInPath("/dashboard/settings"), request.url),
      302,
    );
  }
  // The user is already in hand: reuse it rather than read the session a second time.
  const ctx = await getCreatorContext(user);
  if (!ctx) {
    return NextResponse.redirect(new URL("/onboarding", request.url), 302);
  }
  // An account id never changes once stored (07 D29), so a repeat click skips the lookup.
  const accountId =
    ctx.creator.stripeAccountId ??
    (await ensureConnectedAccount(ctx.creator.id));
  await refreshPayoutsStatus(ctx.creator.id, { maxAgeMs: 0 });
  const link = await paymentsDriver(
    ctx.creator.payoutCurrency,
  ).createOnboardingLink(accountId);
  return NextResponse.redirect(link, 303);
}
