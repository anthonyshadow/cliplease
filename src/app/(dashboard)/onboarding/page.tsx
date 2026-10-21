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
import { Button } from "@/components/ui/button";
import { PRIMARY_WIDTH, TERTIARY } from "@/components/ui/primary-width";
import { Stepper } from "@/components/ui/stepper";
import {
  ONBOARDING_STEP_LABELS,
  ONBOARDING_STEPS,
  type OnboardingStep,
  resolveOnboardingStep,
} from "@/lib/onboarding";
import { getCreatorForApi, requireUser, toActor } from "@/server/auth/session";
import { payoutsStatusForPage } from "@/server/creators/profile";
import { env } from "@/server/env";
import { listAccountSummaries } from "@/server/library/queries";
import { enabledPlatforms } from "@/server/social/registry";
import { PayoutsStep } from "./payouts-step";
import { ProfileStepForm } from "./profile-step-form";

export const metadata: Metadata = { title: "Welcome" };

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
 * S11 (05 §5.2): /onboarding?step=profile|connect|payouts. Without a profile only the profile step renders; with one,
 * connect and payouts (07 D38, D93). One centered max-w-reading column at every tier (07 D145).
 */
export default async function OnboardingPage({
  searchParams,
}: PageProps<"/onboarding">) {
  // A signed-out visitor comes back to the step they opened.
  const user = await requireUser();
  const { step: param, error, connected } = await searchParams;
  const asked = typeof param === "string" ? param : undefined;
  const ctx = await getCreatorForApi();
  const route = resolveOnboardingStep({
    hasProfile: ctx !== null,
    step: asked,
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
          variant="onboarding"
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
        status={
          await payoutsStatusForPage(ctx.creator.id, {
            row: ctx.creator,
          })
        }
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
