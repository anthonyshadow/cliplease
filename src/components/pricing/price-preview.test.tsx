// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DIMENSION_LABELS } from "@/lib/licensing/options";
import { EXCLUSIVE_COPY } from "@/lib/pricing/exclusive-copy";
import { DEFAULT_EXCLUSIVE_MULTIPLIER_BPS } from "@/lib/pricing/presets";
import { effectiveOptions } from "@/server/pricing/rate-card";
import { BARE_DOLLAR } from "../../../tests/helpers/money";
import {
  NO_VIDEO,
  rateCardFixture,
} from "../../../tests/helpers/rate-card-fixtures";
import { PricePreview } from "./price-preview";

afterEach(cleanup);

type Exclusive = ComponentProps<typeof PricePreview>["exclusive"];

const OFFERED = { offered: true, multiplierBps: 30000 } as const;
const STANDARD_LINE =
  "License CA$1,575.00 · Buyer pays CA$1,732.50 (incl. CA$157.50 service fee) · You get CA$1,575.00";

const OPTIONS = effectiveOptions(rateCardFixture(), NO_VIDEO);
// The highest base: its standard price still fits one payment, ×10.00 doesn't.
const TOP_BASE_OPTIONS = effectiveOptions(
  rateCardFixture(undefined, { basePriceCents: 1_000_000 }),
  NO_VIDEO,
);

const preview = (exclusive?: Exclusive, options = OPTIONS) =>
  render(
    <PricePreview
      options={options}
      platformFeeBps={1000}
      exclusive={exclusive}
    />,
  );

const exclusiveLine = () => document.querySelector("[data-exclusive-line]");
const previewText = () =>
  document.querySelector("[data-price-preview]")?.textContent ?? "";
const pickTerm = (value: string) =>
  fireEvent.change(
    screen.getByRole("combobox", { name: DIMENSION_LABELS.term }),
    { target: { value } },
  );

describe("PricePreview's exclusive line (04 §9.29, §11.10; 07 D109)", () => {
  it("adds the premium's line under the standard one, which keeps its price", () => {
    preview(OFFERED);
    expect(exclusiveLine()?.textContent).toBe(
      "Exclusive: License CA$4,725.00 · Buyer pays CA$5,197.50",
    );
    expect(screen.getByText(/^License /).textContent).toBe(STANDARD_LINE);
  });

  it("prices the line at the premium it is given", () => {
    preview({ offered: true, multiplierBps: 40000 });
    expect(exclusiveLine()?.textContent).toBe(
      EXCLUSIVE_COPY.line("CA$6,300.00", "CA$6,930.00"),
    );
    expect(screen.getByText(/^License /).textContent).toBe(STANDARD_LINE);
  });

  it("says Perpetual has none while Perpetual is picked, and prices it again on an exclusive term", () => {
    preview(OFFERED);
    pickTerm("perpetual");
    expect(exclusiveLine()?.textContent).toBe(EXCLUSIVE_COPY.perpetualLine);
    pickTerm("y1");
    expect(exclusiveLine()?.textContent).toBe(
      "Exclusive: License CA$4,725.00 · Buyer pays CA$5,197.50",
    );
  });

  it("says a total over one payment's cap is too high, while the standard line still has a price", () => {
    preview({ offered: true, multiplierBps: 100000 }, TOP_BASE_OPTIONS);
    expect(exclusiveLine()?.textContent).toBe(EXCLUSIVE_COPY.tooHighLine);
    expect(screen.getByText(/^License /).textContent).toContain(
      "License CA$105,000.00",
    );
  });

  it("has no line while it isn't offered, even with Perpetual picked", () => {
    preview({ offered: false, multiplierBps: 30000 });
    expect(exclusiveLine()).toBeNull();
    pickTerm("perpetual");
    expect(exclusiveLine()).toBeNull();
    expect(previewText()).not.toContain("Exclusive");
  });

  it.each([
    ["left out", undefined],
    ["null", null],
  ])("has no line with `exclusive` %s", (_, exclusive) => {
    preview(exclusive);
    expect(exclusiveLine()).toBeNull();
    expect(previewText()).toContain(STANDARD_LINE);
  });

  it("has no line, and doesn't throw, for a premium computeQuote refuses", () => {
    preview({ offered: true, multiplierBps: 1.5 });
    expect(exclusiveLine()).toBeNull();
    expect(previewText()).toContain(STANDARD_LINE);
  });

  it("never prints a bare dollar sign (07 D98)", () => {
    preview({ offered: true, multiplierBps: DEFAULT_EXCLUSIVE_MULTIPLIER_BPS });
    expect(previewText()).not.toMatch(BARE_DOLLAR);
    pickTerm("perpetual");
    expect(previewText()).not.toMatch(BARE_DOLLAR);
  });
});
