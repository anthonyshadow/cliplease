import { describe, expect, it } from "vitest";
import { PAYOUTS_STATUSES } from "./domain/values";
import {
  APPROVAL_WINDOW_LABEL,
  isPayoutsUnavailable,
  PAYOUTS_NOTICE_COPY,
  PAYOUTS_STATUS_LABEL,
  payoutsSetupHref,
  payoutsSetupLabel,
} from "./payouts";

describe("payouts labels (01 J11.1)", () => {
  it("labels every payouts status, with a button only to set up or finish, and unavailable only when refused", () => {
    expect(
      PAYOUTS_STATUSES.map((s) => [
        s,
        PAYOUTS_STATUS_LABEL[s],
        payoutsSetupLabel(s),
        isPayoutsUnavailable(s),
      ]),
    ).toEqual([
      ["not_started", "Not set up", "Set up payouts", false],
      ["pending", "Stripe is checking your details", null, false],
      ["restricted", "Stripe needs more information", "Finish setup", false],
      ["active", "Payouts on", null, false],
      ["rejected", "Payouts unavailable", null, true],
      ["unsupported", "Payouts unavailable", null, true],
    ]);
  });

  it("labels the approval window as 05 §1.5 does", () => {
    expect(APPROVAL_WINDOW_LABEL[72]).toBe("72 hours");
    expect(APPROVAL_WINDOW_LABEL[120]).toBe("5 days");
  });
});

describe("payout setup and the Notice (07 D74; owner answers Q-94 a, Q-95 a)", () => {
  it("links to the setup route, coming back to the page given", () => {
    expect(payoutsSetupHref()).toBe("/api/stripe/onboarding");
    expect(payoutsSetupHref("/dashboard/videos/v1?step=review")).toBe(
      "/api/stripe/onboarding?returnTo=%2Fdashboard%2Fvideos%2Fv1%3Fstep%3Dreview",
    );
  });

  it("says Stripe is checking in the pending Notice", () => {
    expect(PAYOUTS_NOTICE_COPY.pending).toBe(
      "Stripe is checking your details. You can approve requests as soon as they're done.",
    );
  });
});
