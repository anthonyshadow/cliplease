import { describe, expect, it } from "vitest";
import { payoutLine } from "./payout-line";

const transfer = {
  amountCents: 157500,
  currency: "cad",
  takenBack: false,
} as const;

describe("payoutLine (04 §11.5; 07 D75; owner answer Q-146 a)", () => {
  it.each([
    {
      status: "succeeded",
      want: { text: "Paid out", tone: "cleared" },
    },
    {
      status: "pending",
      want: { text: "Payout pending", tone: "neutral" },
    },
    {
      status: "failed",
      want: {
        text: "Finish your payout setup to receive CA$1,575.00.",
        tone: "awaiting",
      },
    },
    { status: "canceled", want: null },
  ] as const)("$status → $want.text", ({ status, want }) => {
    expect(payoutLine({ ...transfer, status })).toEqual(want);
  });

  it("has no line without a transfer", () => {
    expect(payoutLine(null)).toBeNull();
  });

  it("names the failed amount in its own currency", () => {
    expect(
      payoutLine({
        status: "failed",
        amountCents: 26250,
        currency: "usd",
        takenBack: false,
      })?.text,
    ).toBe("Finish your payout setup to receive US$262.50.");
  });
});

describe("payoutLine after a revoke (07 D86; owner answer Q-209)", () => {
  it.each([
    [false, { text: "Paid out", tone: "cleared" }],
    [true, { text: "Taken back", tone: "neutral" }],
  ] as const)("a sent payout taken back (%s) reads %o", (takenBack, want) => {
    expect(payoutLine({ ...transfer, status: "succeeded", takenBack })).toEqual(
      want,
    );
  });

  it.each([false, true])(
    "a canceled payout has no line, whatever the take-back (taken back: %s)",
    (takenBack) => {
      expect(
        payoutLine({ ...transfer, status: "canceled", takenBack }),
      ).toBeNull();
    },
  );
});
