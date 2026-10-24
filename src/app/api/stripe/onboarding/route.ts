import { NextResponse } from "next/server";
import { signInPath } from "@/lib/sign-in";
import {
  getCreatorContext,
  getSessionUser,
  toActor,
} from "@/server/auth/session";
import {
  PAYOUTS_FORCED_READ_MAX_AGE_MS,
  refreshPayoutsStatus,
} from "@/server/creators/profile";
import { env } from "@/server/env";
import { errorName, logEvent } from "@/server/log";
import { ensureConnectedAccount } from "@/server/payments/connect";
import { paymentsDriver } from "@/server/payments/registry";
import { returnToUrl } from "@/server/social/oauth-state";

// "Set up payouts" (02 §6.2, 07 D35, D95): create the connected account on the payout currency's platform account if
// needed, then send the creator to its onboarding link (Stripe from P24; the fake returns straight back). The optional
// `returnTo` (owner answer Q-94: a draft's Review) is where the creator comes back, once it passes 07 D37's rules;
// without it, or when it fails them, Settings. Every creator is 18+ (07 D93). It stays a GET: it is also Stripe's
// refresh_url. P24 revisits the refresh-before-link order for real Stripe and carries `returnTo` into its URLs.

/** Sec-Fetch-Site of a navigation from inside ClipLease, or typed in. A browser too old to send it is let through. */
const IN_APP_FETCH_SITES = new Set(["same-origin", "none"]);

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.redirect(
      new URL(signInPath("/dashboard/settings"), env.APP_URL),
      302,
    );
  }
  // The user is already in hand: reuse it rather than read the session a second time.
  const ctx = await getCreatorContext(user);
  if (!ctx) {
    return NextResponse.redirect(new URL("/onboarding", env.APP_URL), 302);
  }
  // A new account is only started from inside ClipLease (owner answer): another site's link, or a sign-in that lands
  // here, opens Settings, where the creator presses Set up payouts. Stripe's refresh_url always finds a stored account.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    !ctx.creator.stripeAccountId &&
    fetchSite !== null &&
    !IN_APP_FETCH_SITES.has(fetchSite)
  ) {
    return NextResponse.redirect(
      new URL("/dashboard/settings#payouts", env.APP_URL),
      303,
    );
  }
  try {
    // An account id never changes once stored (07 D29), so a repeat click skips the lookup and the re-read uses the
    // session's row; it retries the negative-balance setting while it isn't on, as the creator who pressed. A new
    // account's row is read again, and its setting was just tried.
    const stored = ctx.creator.stripeAccountId;
    const accountId = stored ?? (await ensureConnectedAccount(ctx.creator.id));
    await refreshPayoutsStatus(ctx.creator.id, {
      maxAgeMs: PAYOUTS_FORCED_READ_MAX_AGE_MS,
      row: stored ? ctx.creator : undefined,
      debitsActor: stored ? toActor(ctx) : null,
    });
    const target = returnToUrl(
      new URL(request.url).searchParams.get("returnTo"),
    );
    const link = await paymentsDriver(
      ctx.creator.payoutCurrency,
    ).createOnboardingLink(accountId, {
      returnTo: target ? target.pathname + target.search : undefined,
    });
    return NextResponse.redirect(link, 303);
  } catch (error) {
    // Next's own handler would print the whole error, and a database or Stripe error's message can hold bound values.
    logEvent("error", "payouts.onboarding_failed", {
      error: errorName(error),
    });
    return NextResponse.redirect(
      new URL("/dashboard/settings?payouts=error", env.APP_URL),
      303,
    );
  }
}
