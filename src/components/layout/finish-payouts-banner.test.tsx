// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatDeadline } from "@/lib/format";
import {
  FinishPayoutsBanner,
  TransferFailedBanner,
} from "./finish-payouts-banner";

afterEach(cleanup);

const SOONEST = "2026-10-30T19:10:00.000Z";
const NONE_FAILED = { cents: 0, currency: "cad" } as const;
const FAILED = { cents: 157500, currency: "cad" } as const;
const TRANSFER_LINE = "Finish your payout setup to receive CA$1,575.00.";
const waitingLine = () =>
  `Finish payout setup to approve. This request stays open until ${formatDeadline(
    new Date(SOONEST),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  )}.`;
const setUpHref = () =>
  screen.getByRole("link", { name: "Set up payouts" }).getAttribute("href");

describe("FinishPayoutsBanner (05 §6.3 callout 15; 07 D74, D77)", () => {
  it("shows nothing once payouts are active", () => {
    const { container } = render(
      <FinishPayoutsBanner
        payoutsStatus="active"
        soonestExpiresAt={SOONEST}
        failedTransfer={NONE_FAILED}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("asks to set up payouts while no request waits (info)", () => {
    render(
      <FinishPayoutsBanner
        payoutsStatus="not_started"
        failedTransfer={NONE_FAILED}
      />,
    );
    expect(
      screen.getByText(
        "Set up payouts so you can approve requests (about 2 min)",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("status").className).toContain("bg-fill");
    expect(setUpHref()).toBe("/dashboard/settings#payouts");
  });

  it("warns that a waiting request stays open until the soonest deadline", () => {
    render(
      <FinishPayoutsBanner
        payoutsStatus="pending"
        soonestExpiresAt={SOONEST}
        failedTransfer={NONE_FAILED}
      />,
    );
    expect(screen.getByText(waitingLine())).toBeTruthy();
    expect(screen.getByRole("status").className).toContain("bg-awaiting-tint");
    expect(setUpHref()).toBe("/dashboard/settings#payouts");
  });
});

describe("FinishPayoutsBanner after a failed transfer (04 §9.21; 07 D75; owner answers Q-147 a, Q-150 a)", () => {
  it("shows the transfer Banner while payouts are active: warning tone, a status, the setup route", () => {
    render(
      <FinishPayoutsBanner
        payoutsStatus="active"
        soonestExpiresAt={SOONEST}
        failedTransfer={FAILED}
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner.className).toContain("bg-awaiting-tint");
    expect(screen.getByText(TRANSFER_LINE)).toBeTruthy();
    // Payouts are on: no J8.3 sentence, even with a request waiting.
    expect(screen.queryByText(/Finish payout setup to approve/)).toBeNull();
    expect(setUpHref()).toBe("/api/stripe/onboarding");
  });

  it("wins over the info Banner: one Banner, the transfer sentence only", () => {
    render(
      <FinishPayoutsBanner
        payoutsStatus="not_started"
        failedTransfer={FAILED}
      />,
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByText(TRANSFER_LINE)).toBeTruthy();
    expect(screen.queryByText(/Set up payouts so you can approve/)).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(setUpHref()).toBe("/api/stripe/onboarding");
  });

  it("wins over the warning Banner, and keeps J8.3's deadline sentence after its own in the same Banner", () => {
    render(
      <FinishPayoutsBanner
        payoutsStatus="restricted"
        soonestExpiresAt={SOONEST}
        failedTransfer={FAILED}
      />,
    );
    const banner = screen.getByRole("status");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(banner.className).toContain("bg-awaiting-tint");
    const lines = [...banner.querySelectorAll("p")].map((p) => p.textContent);
    expect(lines).toEqual([TRANSFER_LINE, waitingLine()]);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(setUpHref()).toBe("/api/stripe/onboarding");
  });

  it.each(["rejected", "unsupported"] as const)(
    "says payouts are unavailable instead of linking to setup (%s)",
    (payoutsStatus) => {
      render(
        <FinishPayoutsBanner
          payoutsStatus={payoutsStatus}
          failedTransfer={FAILED}
        />,
      );
      expect(screen.getByText(TRANSFER_LINE)).toBeTruthy();
      expect(screen.getByText(/Payouts unavailable\. Contact/)).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Set up payouts" })).toBeNull();
    },
  );
});

describe("TransferFailedBanner alone (Settings; 05 §6.11)", () => {
  it("names the failed sum in the payout currency, with Set up payouts to the setup route", () => {
    render(
      <TransferFailedBanner
        failedTransfer={{ cents: 26250, currency: "usd" }}
        payoutsStatus="active"
      />,
    );
    expect(screen.getByRole("status").className).toContain("bg-awaiting-tint");
    expect(
      screen.getByText("Finish your payout setup to receive US$262.50."),
    ).toBeTruthy();
    expect(setUpHref()).toBe("/api/stripe/onboarding");
  });

  it("shows the transfer sentence alone without a waiting deadline", () => {
    render(
      <TransferFailedBanner
        failedTransfer={FAILED}
        payoutsStatus="restricted"
      />,
    );
    const lines = [...screen.getByRole("status").querySelectorAll("p")].map(
      (p) => p.textContent,
    );
    expect(lines).toEqual([TRANSFER_LINE]);
  });

  it("shows nothing when no transfer failed", () => {
    const { container } = render(
      <TransferFailedBanner
        failedTransfer={NONE_FAILED}
        payoutsStatus="restricted"
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});
