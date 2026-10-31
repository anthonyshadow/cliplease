import { describe, expect, it } from "vitest";
import { payoutLine } from "./payout-line";

const transfer = { amountCents: 157500, currency: "cad" } as const;

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
      payoutLine({ status: "failed", amountCents: 26250, currency: "usd" })
        ?.text,
    ).toBe("Finish your payout setup to receive US$262.50.");
  });
});
