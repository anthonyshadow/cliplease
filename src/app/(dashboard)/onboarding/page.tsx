import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { CONNECT_PAGE_LINE } from "@/components/connections/connect-messages";
import { ConnectSection } from "@/components/connections/connect-section";
import { AppShell } from "@/components/layout/app-shell";
import { READING_COLUMN } from "@/components/layout/gutter";
import { NavBar } from "@/components/layout/nav-bar";
import { SignOutMenuItem } from "@/components/layout/sign-out";
import { PayoutCurrencyFacts } from "@/components/payouts/payout-currency-facts";
import { Button } from "@/components/ui/button";
import { PRIMARY_WIDTH } from "@/components/ui/primary-width";
import { Stepper } from "@/components/ui/stepper";
import type { Currency, PayoutsStatus } from "@/lib/domain/values";
import {
  ONBOARDING_STEP_LABELS,
  ONBOARDING_STEPS,
  type OnboardingStep,
  resolveOnboardingStep,
} from "@/lib/onboarding";
import { PAYOUTS_STATUS_LABEL } from "@/lib/payouts";
import { getCreatorForApi, requireUser, toActor } from "@/server/auth/session";
import { refreshPayoutsStatus } from "@/server/creators/profile";
import { env } from "@/server/env";
import { listAccountSummaries } from "@/server/library/queries";
import { enabledPlatforms } from "@/server/social/registry";
import { ProfileStepForm } from "./profile-step-form";

export const metadata: Metadata = { title: "Welcome" };

// Tertiaries sit on the column's left edge.
const TERTIARY = "self-start px-0";

function Heading({ step }: { step: OnboardingStep }) {
  if (step === "profile") {
    return (
      <h1 className="text-title-1 text-ink">
        Welcome. <span className="text-ink-2">Pick your handle.</span>
      </h1>
    );
  }
  return (
    <h1 className="text-title-1 text-ink">
      {step === "connect"
        ? "Connect your accounts"
        : "Set up payouts (about 2 min)"}
    </h1>
  );
}

/** Step 2: link a platform (`children`, the ConnectSection), then Continue, or skip it and upload. A connect comes back here (07 D37). */
function ConnectStep({
  payoutsActive,
  children,
}: {
  payoutsActive: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <p className="text-body text-ink-2">{CONNECT_PAGE_LINE}</p>
      {children}
      <Button asChild className={PRIMARY_WIDTH}>
        <Link
          href={
            payoutsActive ? "/dashboard/library" : "/onboarding?step=payouts"
          }
        >
          Continue
        </Link>
      </Button>
      <Button asChild variant="tertiary" className={TERTIARY}>
        <Link href="/onboarding?step=payouts">Skip, I'll upload a video</Link>
      </Button>
    </>
  );
}

/**
 * Step 3: publishing never waits for payouts (07 D74). Payouts already on (a judgment call): "Payouts on" and Continue
 * to the Library; pending: Stripe's line and Continue. Set up payouts is a plain link: the route creates the account.
 */
function PayoutsStep({
  status,
  currency,
}: {
  status: PayoutsStatus;
  currency: Currency;
}) {
  const settled = status === "active" || status === "pending";
  let actions: ReactNode;
  if (settled) {
    actions = (
      <Button asChild className={PRIMARY_WIDTH}>
        <Link href="/dashboard/library">Continue</Link>
      </Button>
    );
  } else {
    actions = (
      <>
        <Button asChild className={PRIMARY_WIDTH}>
          <a href="/api/stripe/onboarding">Set up payouts</a>
        </Button>
        <Button asChild variant="tertiary" className={TERTIARY}>
          <Link href="/dashboard/library">Skip for now</Link>
        </Button>
      </>
    );
  }
  return (
    <>
      <p className="text-callout text-ink-2">
        You can publish now. You'll need payouts set up to approve a request.
      </p>
      {status === "active" ? (
        <p className="text-body text-ink">{PAYOUTS_STATUS_LABEL.active}</p>
      ) : null}
      {status === "pending" ? (
        <p className="text-body text-ink">Stripe is checking your details.</p>
      ) : null}
      <PayoutCurrencyFacts currency={currency} />
      {actions}
    </>
  );
}

/**
 * S11 (05 §5.2): /onboarding?step=profile|connect|payouts. Without a profile only the profile step renders; with one,
 * connect and payouts (07 D38, D93). One centered max-w-reading column at every tier (07 D145).
 */
export default async function OnboardingPage({
  searchParams,
}: PageProps<"/onboarding">) {
  const user = await requireUser("/onboarding");
  const { step: param, error, connected } = await searchParams;
  const ctx = await getCreatorForApi();
  const route = resolveOnboardingStep({
    hasProfile: ctx !== null,
    step: typeof param === "string" ? param : undefined,
  });
  if (route.kind === "redirect") redirect(route.to);
  const { step } = route;

  let body: ReactNode;
  if (step === "profile") {
    body = <ProfileStepForm linkHost={new URL(env.APP_URL).host} />;
  } else if (step === "connect" && ctx) {
    body = (
      <ConnectStep payoutsActive={ctx.creator.payoutsStatus === "active"}>
        <ConnectSection
          platforms={enabledPlatforms()}
          accounts={await listAccountSummaries(toActor(ctx))}
          returnTo="/onboarding?step=connect"
          error={error}
          connected={connected}
        />
      </ConnectStep>
    );
  } else if (ctx) {
    body = (
      <PayoutsStep
        status={await refreshPayoutsStatus(ctx.creator.id)}
        currency={ctx.creator.payoutCurrency}
      />
    );
  }

  return (
    <AppShell
      nav={
        <NavBar
          variant="creator"
          withoutProfile
          user={{ name: user.name || user.email }}
          signOut={<SignOutMenuItem />}
        />
      }
    >
      <div className={READING_COLUMN}>
        <div className="flex flex-col gap-4">
          <Heading step={step} />
          <Stepper
            steps={ONBOARDING_STEP_LABELS}
            current={ONBOARDING_STEPS.indexOf(step)}
          />
        </div>
        {body}
      </div>
    </AppShell>
  );
}
