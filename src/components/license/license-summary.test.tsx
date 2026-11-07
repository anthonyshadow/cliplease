// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { licenseSummary } from "@/lib/licensing/summary";
import { LicenseSummary } from "./license-summary";

afterEach(cleanup);

const SUMMARY = licenseSummary({
  useKey: "paid_social",
  termKey: "y1",
  territoryKey: "worldwide",
  territoryCode: null,
  handle: "maya",
  creditLine: "Video: @maya.films on Instagram",
  containsMusic: false,
  identifiablePeople: false,
});

describe("LicenseSummary (04 §9.5)", () => {
  it("ends with the currency line on the license page", () => {
    render(<LicenseSummary summary={SUMMARY} currency="cad" />);
    expect(screen.getByText("Prices in Canadian dollars (CAD).")).toBeTruthy();
  });

  it("has no currency line without a currency: /l's card already says Amounts in … (07 D98)", () => {
    const { container } = render(<LicenseSummary summary={SUMMARY} />);
    expect(container.textContent).not.toContain("Prices in");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      SUMMARY.heading,
    );
    expect(
      screen.getByRole("link", {
        name: `${SUMMARY.footer.link.text} (opens in a new tab)`,
      }),
    ).toBeTruthy();
  });
});
