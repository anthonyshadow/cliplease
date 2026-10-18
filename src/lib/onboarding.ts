// Onboarding steps and their redirects (07 D38, amended by D74 and D93). Pure.

export const ONBOARDING_STEPS = ["profile", "connect", "payouts"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** The Stepper's labels, in step order (05 §5.2 callout 2, proposed copy). */
export const ONBOARDING_STEP_LABELS = [
  "Profile",
  "Connect",
  "Payouts",
] as const;

export type OnboardingRoute =
  | { kind: "render"; step: OnboardingStep }
  | { kind: "redirect"; to: string };

/**
 * What /onboarding?step= does: without a profile only the profile step renders (anything else goes there); with a
 * profile, connect and payouts render and everything else (profile, a missing or unknown step) goes to /dashboard.
 */
export function resolveOnboardingStep({
  hasProfile,
  step,
}: {
  hasProfile: boolean;
  step: string | null | undefined;
}): OnboardingRoute {
  if (!hasProfile) {
    return step === "profile"
      ? { kind: "render", step: "profile" }
      : { kind: "redirect", to: "/onboarding?step=profile" };
  }
  if (step === "connect" || step === "payouts") return { kind: "render", step };
  return { kind: "redirect", to: "/dashboard" };
}
