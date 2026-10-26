// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { UseKey } from "@/lib/domain/values";
import type { LicensePageDTO } from "@/lib/licensing/license-page";
import { defaultSelection } from "@/lib/licensing/selection";
import { publicBadge } from "@/lib/videos/ownership";
import { MUSIC_DISABLED_USES } from "@/lib/videos/rights";
import { effectiveOptions } from "@/server/pricing/rate-card";
import { rateCardFixture } from "@/server/pricing/rate-card-fixtures";
import { LicensePageClient } from "./license-page-client";

beforeAll(() => {
  // jsdom has neither; the PriceBar measures itself and keeps focus clear of itself.
  document.elementFromPoint ??= () => null;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const SUBMISSION_ID = "6f4c8d7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

function page(
  video: { disabledUses?: UseKey[]; containsMusic?: boolean } = {},
): LicensePageDTO {
  const options = effectiveOptions(rateCardFixture(), {
    disabledUses: video.disabledUses ?? [],
    basePriceOverrideCents: null,
  });
  const selection = defaultSelection(options, 1000);
  if (!selection) throw new Error("fixture: nothing fits");
  return {
    video: {
      id: "00000000-0000-4000-8000-000000000101",
      slug: "first-snow",
      title: "First snow",
      width: 720,
      height: 1280,
      posterUrl:
        "/api/media/posters/00000000-0000-4000-8000-000000000101?v=0a1b2c3d",
      containsMusic: video.containsMusic ?? false,
      identifiablePeople: false,
    },
    creator: {
      handle: "maya",
      displayName: "Maya R.",
      approvalWindowHours: 72,
    },
    postings: { primary: null, postings: [] },
    badge: publicBadge({ primary: null, postings: [] }, "lg"),
    options,
    platformFeeBps: 1000,
    platformFeeMinCents: 200,
    selection,
  };
}

const show = (dto = page()) =>
  render(<LicensePageClient page={dto} submissionId={SUBMISSION_ID} />);
const radio = (group: string, value: string) => {
  const input = document.querySelector<HTMLInputElement>(
    `input[name=${group}][value=${value}]`,
  );
  if (!input) throw new Error(`no ${group} ${value}`);
  return input;
};
const tileOf = (group: string, value: string) =>
  radio(group, value).closest<HTMLElement>("[data-option-tile]");
const bar = () => document.querySelector<HTMLElement>("[data-pricebar]");
const hidden = (name: string) =>
  document.querySelector<HTMLInputElement>(`input[type=hidden][name=${name}]`)
    ?.value;
const choose = (group: string, value: string) =>
  fireEvent.click(radio(group, value));

describe("LicensePageClient (01 J7; 05 §4.1)", () => {
  it("first load: Organic social repost · 30 days · One country, its prices, and Choose a country", () => {
    show();
    expect(radio("use", "organic_social").checked).toBe(true);
    expect(radio("term", "d30").checked).toBe(true);
    expect(radio("territory", "country").checked).toBe(true);
    const priceBar = bar();
    if (!priceBar) throw new Error("no PriceBar");
    expect(priceBar.querySelector("[data-price-lines]")?.textContent).toBe(
      "License CA$150.00 · Service fee CA$15.00",
    );
    expect(priceBar.querySelector("[data-price-total]")?.textContent).toContain(
      "Total CA$165.00",
    );
    const button = within(priceBar).getByRole("button");
    expect(button.textContent).toBe("Choose a country");
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("form")).toBe("license-form");
    expect(hidden("expectedTotalCents")).toBe("16500");
    expect(hidden("submissionId")).toBe(SUBMISSION_ID);
    expect(hidden("territoryCode")).toBe("");
    expect(hidden("termsVersion")).toBe("v1");
  });

  it("Paid social ads · 1 year · Worldwide: the D79 golden, Request license, and the license-price deltas", () => {
    show();
    choose("use", "paid_social");
    choose("term", "y1");
    choose("territory", "worldwide");
    const priceBar = bar();
    expect(priceBar?.querySelector("[data-price-lines]")?.textContent).toBe(
      "License CA$1,575.00 · Service fee CA$157.50",
    );
    expect(
      priceBar?.querySelector("[data-price-total]")?.textContent,
    ).toContain("Total CA$1,732.50");
    expect(
      within(priceBar as HTMLElement).getByRole("button").textContent,
    ).toBe("Request license · CA$1,732.50");
    expect(hidden("expectedTotalCents")).toBe("173250");
    expect(hidden("useKey")).toBe("paid_social");
    expect(hidden("termKey")).toBe("y1");
    expect(hidden("territoryKey")).toBe("worldwide");
    const deltas = Object.fromEntries(
      [
        ["use", "organic_social"],
        ["use", "broadcast"],
        ["term", "d30"],
        ["term", "m6"],
        ["term", "perpetual"],
        ["territory", "country"],
        ["territory", "region"],
      ].map(([group, key]) => [
        key,
        tileOf(group as string, key as string)?.querySelector(".tabular-nums")
          ?.textContent,
      ]),
    );
    expect(deltas).toEqual({
      organic_social: "− CA$1,050",
      broadcast: "+ CA$1,050",
      d30: "− CA$787.50",
      m6: "− CA$393.75",
      perpetual: "+ CA$787.50",
      country: "− CA$675",
      region: "− CA$405",
    });
    // The selected tile keeps its delta's room but hides it, from screen readers too.
    const own = tileOf("use", "paid_social")?.querySelector(".tabular-nums");
    expect(own?.className).toContain("invisible");
    expect(own?.getAttribute("aria-hidden")).toBe("true");
  });

  it("a music video: Paid social ads and TV / broadcast disabled with the music reason and no delta (07 D82)", () => {
    show(page({ containsMusic: true, disabledUses: [...MUSIC_DISABLED_USES] }));
    for (const key of MUSIC_DISABLED_USES) {
      expect(radio("use", key).disabled).toBe(true);
      const tile = tileOf("use", key);
      expect(tile?.textContent).toContain(
        "Not available: this video has music the creator doesn't own.",
      );
      expect(tile?.querySelector(".tabular-nums")).toBeNull();
    }
    expect(radio("use", "organic_social").checked).toBe(true);
  });

  it("the territory select: a country fills territoryCode and the summary; a new territory clears it", () => {
    show();
    const country = screen.getByLabelText("Country") as HTMLSelectElement;
    expect(tileOf("territory", "country")?.contains(country)).toBe(true);
    expect(country.options[0]?.textContent).toBe("Choose a country");
    fireEvent.change(country, { target: { value: "US" } });
    expect(hidden("territoryCode")).toBe("US");
    expect(within(bar() as HTMLElement).getByRole("button").textContent).toBe(
      "Request license · CA$165.00",
    );
    expect(
      screen.getByRole("heading", {
        name: "License summary · Organic social repost · 30 days · United States",
      }),
    ).toBeTruthy();
    expect(document.body.textContent).toContain(
      "without paying to promote it in the United States, for 30 days from approval.",
    );
    choose("territory", "region");
    expect(hidden("territoryCode")).toBe("");
    expect(screen.queryByLabelText("Country")).toBeNull();
    const region = screen.getByLabelText("Region") as HTMLSelectElement;
    expect(region.options[0]?.textContent).toBe("Choose a region");
    expect(within(bar() as HTMLElement).getByRole("button").textContent).toBe(
      "Choose a region",
    );
    fireEvent.change(region, { target: { value: "middle_east_africa" } });
    expect(hidden("territoryCode")).toBe("middle_east_africa");
  });

  it("a tap on One region moves focus into its select; arrow keys don't (owner answer Q-113 a)", () => {
    show();
    const group = screen.getByRole("group", { name: /^Territory\./ });
    fireEvent.keyDown(group, { key: "ArrowDown" });
    choose("territory", "region");
    expect(document.activeElement).not.toBe(screen.getByLabelText("Region"));
    fireEvent.pointerDown(tileOf("territory", "country") as HTMLElement);
    choose("territory", "country");
    expect(document.activeElement).toBe(screen.getByLabelText("Country"));
  });

  it("Which countries? lists each region's countries", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Which countries?" }));
    const sheet = screen.getByRole("dialog", { name: "Which countries?" });
    expect(within(sheet).getByText("North America (US & Canada)")).toBeTruthy();
    expect(within(sheet).getByText("Canada, United States")).toBeTruthy();
  });

  it("announces the total 500 ms after it settles, never on load (04 §9.4)", () => {
    vi.useFakeTimers();
    show();
    const status = within(bar() as HTMLElement).getByRole("status");
    expect(status.textContent).toBe("");
    choose("territory", "worldwide");
    act(() => vi.advanceTimersByTime(499));
    expect(status.textContent).toBe("");
    act(() => vi.advanceTimersByTime(1));
    expect(status.textContent).toBe("Total CA$288.75");
  });

  it("renders no clock or zone on the server; the deadline and timeZone come after mount", () => {
    const html = renderToStaticMarkup(
      <LicensePageClient page={page()} submissionId={SUBMISSION_ID} />,
    );
    expect(html).toContain("You won&#x27;t be charged unless @maya approves.");
    expect(html).not.toContain("declines or doesn&#x27;t answer by");
    expect(html).toContain('name="timeZone" value=""');
    show();
    expect(hidden("timeZone")).not.toBe("");
    expect(document.body.textContent).toMatch(
      /If @maya declines or doesn't answer by \w{3} \d{1,2} \w{3}, \d{1,2}:\d{2} [AP]M \S+, the hold is released and you pay nothing\./,
    );
  });

  it("prints the currency lines and no bare $ (07 D98)", () => {
    show();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Prices in Canadian dollars (CAD).");
    expect(text).toContain(
      "Your card is charged in Canadian dollars. If your card uses another currency, your bank converts it and may add a fee.",
    );
    expect(text).not.toMatch(/(?<!CA)\$/);
  });
});
