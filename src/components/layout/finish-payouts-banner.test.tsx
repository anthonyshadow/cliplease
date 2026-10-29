// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatDeadline } from "@/lib/format";
import { FinishPayoutsBanner } from "./finish-payouts-banner";

afterEach(cleanup);

const SOONEST = "2026-10-30T19:10:00.000Z";

describe("FinishPayoutsBanner (05 §6.3 callout 15; 07 D74, D77)", () => {
  it("shows nothing once payouts are active", () => {
    const { container } = render(
      <FinishPayoutsBanner payoutsStatus="active" soonestExpiresAt={SOONEST} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("asks to set up payouts while no request waits (info)", () => {
    render(<FinishPayoutsBanner payoutsStatus="not_started" />);
    expect(
      screen.getByText(
        "Set up payouts so you can approve requests (about 2 min)",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("status").className).toContain("bg-fill");
    expect(
      screen.getByRole("link", { name: "Set up payouts" }).getAttribute("href"),
    ).toBe("/dashboard/settings#payouts");
  });

  it("warns that a waiting request stays open until the soonest deadline", () => {
    render(
      <FinishPayoutsBanner
        payoutsStatus="pending"
        soonestExpiresAt={SOONEST}
      />,
    );
    const deadline = formatDeadline(
      new Date(SOONEST),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(
      screen.getByText(
        `Finish payout setup to approve. This request stays open until ${deadline}.`,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("status").className).toContain("bg-awaiting-tint");
    expect(
      screen.getByRole("link", { name: "Set up payouts" }).getAttribute("href"),
    ).toBe("/dashboard/settings#payouts");
  });
});
