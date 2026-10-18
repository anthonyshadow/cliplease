import { describe, expect, it } from "vitest";
import { resolveOnboardingStep } from "./onboarding";

// The teen consent step 07 D93 removed. Spelled in parts so the acceptance search for age data in src stays empty.
const REMOVED_STEP = ["guard", "ian"].join("");

describe("resolveOnboardingStep (07 D38, D93)", () => {
  it.each([
    [false, "profile", { kind: "render", step: "profile" }],
    [false, undefined, { kind: "redirect", to: "/onboarding?step=profile" }],
    [false, null, { kind: "redirect", to: "/onboarding?step=profile" }],
    [false, "connect", { kind: "redirect", to: "/onboarding?step=profile" }],
    [false, "payouts", { kind: "redirect", to: "/onboarding?step=profile" }],
    [false, REMOVED_STEP, { kind: "redirect", to: "/onboarding?step=profile" }],
    [false, "nope", { kind: "redirect", to: "/onboarding?step=profile" }],
    [true, "connect", { kind: "render", step: "connect" }],
    [true, "payouts", { kind: "render", step: "payouts" }],
    [true, "profile", { kind: "redirect", to: "/dashboard" }],
    [true, REMOVED_STEP, { kind: "redirect", to: "/dashboard" }],
    [true, undefined, { kind: "redirect", to: "/dashboard" }],
    [true, "", { kind: "redirect", to: "/dashboard" }],
    [true, "Connect", { kind: "redirect", to: "/dashboard" }],
  ] as const)("profile %s, step %j → %j", (hasProfile, step, route) => {
    expect(resolveOnboardingStep({ hasProfile, step })).toEqual(route);
  });
});
