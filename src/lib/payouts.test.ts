import { describe, expect, it } from "vitest";
import { PAYOUTS_STATUSES } from "./domain/values";
import {
  APPROVAL_WINDOW_LABEL,
  PAYOUTS_STATUS_LABEL,
  payoutsSetupLabel,
} from "./payouts";

describe("payouts labels (01 J11.1)", () => {
  it("labels every payouts status, with a button only to set up or finish", () => {
    expect(
      PAYOUTS_STATUSES.map((s) => [
        s,
        PAYOUTS_STATUS_LABEL[s],
        payoutsSetupLabel(s),
      ]),
    ).toEqual([
      ["not_started", "Not set up", "Set up payouts"],
      ["pending", "Stripe is checking your details", null],
      ["restricted", "Stripe needs more information", "Finish setup"],
      ["active", "Payouts on", null],
      ["rejected", "Payouts unavailable", null],
      ["unsupported", "Payouts unavailable", null],
    ]);
  });

  it("labels the approval window as 05 §1.5 does", () => {
    expect(APPROVAL_WINDOW_LABEL[72]).toBe("72 hours");
    expect(APPROVAL_WINDOW_LABEL[120]).toBe("5 days");
  });
});
