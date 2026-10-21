import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SUPPORT_EMAIL } from "@/lib/app-name";
import type { PayoutsStatus } from "@/lib/domain/values";
import { PayoutsStep } from "./payouts-step";

const render = (status: PayoutsStatus) =>
  renderToStaticMarkup(<PayoutsStep status={status} currency="cad" />);

/** The step's links, in order, as "label → href". */
const links = (html: string) =>
  [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
    .map(([, href, label]) => `${label} → ${href}`)
    .filter((link) => !link.startsWith("Payout terms"));

/** The status line's text (the one `text-body text-ink` paragraph), or null without one. */
const statusLine = (html: string) => {
  const line = html.match(/<p class="text-body text-ink">(.*?)<\/p>/)?.[1];
  return line === undefined ? null : line.replace(/<[^>]+>/g, "");
};

describe("the onboarding payouts step (01 J11.1, 05 §5.2)", () => {
  it("offers Settings' button with Skip for now, or Continue when there is nothing to set up", () => {
    expect(links(render("not_started"))).toEqual([
      "Set up payouts → /api/stripe/onboarding",
      "Skip for now → /dashboard/library",
    ]);
    expect(links(render("restricted"))).toEqual([
      "Finish setup → /api/stripe/onboarding",
      "Skip for now → /dashboard/library",
    ]);
    for (const status of ["pending", "active"] as const) {
      expect(links(render(status))).toEqual(["Continue → /dashboard/library"]);
    }
  });

  it("shows the status Settings shows, and a refused account the unavailable line instead of a setup link", () => {
    expect(statusLine(render("not_started"))).toBeNull();
    expect(statusLine(render("pending"))).toBe(
      "Stripe is checking your details.",
    );
    expect(statusLine(render("restricted"))).toBe(
      "Stripe needs more information",
    );
    expect(statusLine(render("active"))).toBe("Payouts on");
    for (const status of ["rejected", "unsupported"] as const) {
      expect(statusLine(render(status))).toBe(
        `Payouts unavailable. Contact ${SUPPORT_EMAIL}.`,
      );
      expect(links(render(status))).toEqual([
        `${SUPPORT_EMAIL} → mailto:${SUPPORT_EMAIL}`,
        "Continue → /dashboard/library",
      ]);
    }
  });
});
