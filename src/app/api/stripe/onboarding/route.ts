import { NextResponse } from "next/server";
import { signInPath } from "@/lib/sign-in";
import { getCreatorForApi, getSessionUser } from "@/server/auth/session";
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
  const ctx = await getCreatorForApi();
  if (!ctx) {
    return NextResponse.redirect(new URL("/onboarding", request.url), 302);
  }
  const accountId = await ensureConnectedAccount(ctx.creator.id);
  await refreshPayoutsStatus(ctx.creator.id, { maxAgeMs: 0 });
  const link = await paymentsDriver(
    ctx.creator.payoutCurrency,
  ).createOnboardingLink(accountId);
  return NextResponse.redirect(link, 303);
}
