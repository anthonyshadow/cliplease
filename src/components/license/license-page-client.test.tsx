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
import type { RateOptionKey, UseKey } from "@/lib/domain/values";
import { formatDeadline } from "@/lib/format";
import {
  LICENSE_PAGE_COPY,
  type LicensePageDTO,
} from "@/lib/licensing/license-page";
import { defaultSelection } from "@/lib/licensing/selection";
import { HOUR_MS } from "@/lib/time";
import { publicBadge } from "@/lib/videos/ownership";
import { MUSIC_DISABLED_USES } from "@/lib/videos/rights";
import { effectiveOptions } from "@/server/pricing/rate-card";
import {
  NO_VIDEO,
  rateCardFixture,
} from "../../../tests/helpers/rate-card-fixtures";
import { LicensePageClient } from "./license-page-client";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  startCheckout: vi.fn(),
}));
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/app/(public)/u/[handle]/[slug]/actions", () => ({
  startCheckout: mocks.startCheckout,
}));

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
  mocks.refresh.mockReset();
  mocks.startCheckout.mockReset();
  vi.useRealTimers();
});

const SUBMISSION_ID = "6f4c8d7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

const OTHERS_RUNNING = {
  state: "non_exclusive_only",
  canRequestExclusive: false,
  canRequestNonExclusive: true,
  until: null,
} as const;

function page(
  video: { disabledUses?: UseKey[]; containsMusic?: boolean } = {},
  {
    autoApprove = false,
    approvalWindowHours = 72,
    exclusiveEnabled = false,
    off = [],
    availability = {
      state: "open",
      canRequestExclusive: exclusiveEnabled,
      canRequestNonExclusive: true,
      until: null,
    },
  }: {
    autoApprove?: boolean;
    approvalWindowHours?: number;
    exclusiveEnabled?: boolean;
    /** Options the creator turned off. */
    off?: RateOptionKey[];
    availability?: LicensePageDTO["availability"];
  } = {},
): LicensePageDTO {
  const options = effectiveOptions(
    rateCardFixture((o) => ({ enabled: !off.includes(o.key) }), {
      exclusiveEnabled,
    }),
    {
      ...NO_VIDEO,
      disabledUses: video.disabledUses ?? [],
    },
  );
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
      approvalWindowHours,
      autoApprove,
    },
    postings: { primary: null, postings: [] },
    badge: publicBadge({ primary: null, postings: [] }, "lg"),
    options,
    platformFeeBps: 1000,
    platformFeeMinCents: 200,
    selection,
    availability,
  };
}

/** A creator who offers exclusive licenses at ×3.00, on a video that can take one unless told otherwise. */
const offering = (availability?: LicensePageDTO["availability"]) =>
  page({}, { exclusiveEnabled: true, availability });

const show = (dto = page()) =>
  render(<LicensePageClient page={dto} submissionId={SUBMISSION_ID} />);
const radio = (group: string, value: string) => {
  const input = document.querySelector<HTMLInputElement>(
    `input[type=radio][name=${group}][value=${value}]`,
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
/** The PriceBar's button by the name it has now (the loading label is aria-hidden until it is pending). */
const barButton = (name: string) =>
  within(bar() as HTMLElement).getByRole("button", { name });
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
    // Enabled once the page has hydrated (a press before that would post the form to the page itself).
    expect(barButton("Choose a country")).toHaveProperty("disabled", false);
    expect(barButton("Choose a country").getAttribute("form")).toBe(
      "license-form",
    );
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
    barButton("Request license · CA$1,732.50");
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
    barButton("Request license · CA$165.00");
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
    barButton("Choose a region");
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

  it("auto-approve: Instant approval. and the charge now, the same on the server and after mount, with no deadline (01 J7.6; 07 D81)", () => {
    const auto = page({}, { autoApprove: true });
    const html = renderToStaticMarkup(
      <LicensePageClient page={auto} submissionId={SUBMISSION_ID} />,
    );
    expect(html).toContain("Instant approval.");
    expect(html).toContain(
      "@maya approves requests automatically. You&#x27;ll be charged CA$165.00 now and get the file right away.",
    );
    expect(html).not.toContain("won&#x27;t be charged");
    expect(html).not.toContain("answer by");
    show(auto);
    const text = document.body.textContent ?? "";
    expect(text).toContain(
      "Instant approval. @maya approves requests automatically. You'll be charged CA$165.00 now and get the file right away.",
    );
    expect(text).not.toContain("won't be charged");
    expect(text).not.toContain("answer by");
  });

  it.each([24, 120])(
    "manual: the deadline after mount is now + the creator's %i h window, in the viewer's zone",
    (hours) => {
      const now = new Date("2026-10-27T14:00:00Z").getTime();
      vi.useFakeTimers();
      vi.setSystemTime(now);
      show(page({}, { approvalWindowHours: hours }));
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      expect(document.body.textContent).toContain(
        LICENSE_PAGE_COPY.holdDeadline(
          "maya",
          formatDeadline(new Date(now + hours * HOUR_MS), zone),
        ),
      );
    },
  );

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

describe("License type (P19f; 01 J12; 04 §9.35; 07 D110, D112)", () => {
  const typeGroup = () =>
    screen.queryByRole("group", { name: /^License type\./ });
  const liveLine = () => document.querySelector("[data-term-moved]");
  const lines = () => bar()?.querySelector("[data-price-lines]")?.textContent;
  const deltaOf = (group: string, value: string) =>
    tileOf(group, value)?.querySelector(".tabular-nums");
  const chooseDemo = () => {
    choose("use", "paid_social");
    choose("term", "y1");
    choose("territory", "worldwide");
  };

  it("has no group when the creator doesn't offer it, and posts a standard license", () => {
    show();
    expect(typeGroup()).toBeNull();
    expect(document.querySelector("input[type=radio][name=exclusive]")).toBe(
      null,
    );
    expect(hidden("exclusive")).toBe("false");
  });

  it("opens on Standard, with Exclusive's delta at the demo selection", () => {
    show(offering());
    chooseDemo();
    expect(typeGroup()).not.toBeNull();
    expect(radio("exclusive", "false").checked).toBe(true);
    expect(hidden("exclusive")).toBe("false");
    expect(deltaOf("exclusive", "true")?.textContent).toBe("+ CA$3,150");
    barButton("Request license · CA$1,732.50");
  });

  it("Exclusive prices the premium everywhere: the bar, the form's total and the summary", () => {
    show(offering());
    chooseDemo();
    choose("exclusive", "true");
    expect(lines()).toBe("License CA$4,725.00 · Service fee CA$472.50");
    expect(hidden("exclusive")).toBe("true");
    expect(hidden("expectedTotalCents")).toBe("519750");
    barButton("Request license · CA$5,197.50");
    expect(deltaOf("exclusive", "false")?.textContent).toBe("− CA$3,150");
    expect(document.body.textContent).toContain(
      "@maya won't license this video to anyone else, for any use or place, for 1 year from approval.",
    );
  });

  it("Exclusive from Perpetual moves the term to 1 year, says so, and leaves the focus where it is", () => {
    show(offering());
    choose("term", "perpetual");
    expect(liveLine()?.textContent).toBe("");
    const exclusive = radio("exclusive", "true");
    exclusive.focus();
    choose("exclusive", "true");
    expect(radio("term", "y1").checked).toBe(true);
    expect(hidden("termKey")).toBe("y1");
    expect(liveLine()?.textContent).toBe(
      "Term changed to 1 year. Exclusive licenses last up to 1 year.",
    );
    expect(document.activeElement).toBe(exclusive);
  });

  it("empties the live line on Standard, and a term chosen after the move leaves it empty", () => {
    show(offering());
    choose("term", "perpetual");
    choose("exclusive", "true");
    choose("exclusive", "false");
    expect(liveLine()?.textContent).toBe("");
    // Standard keeps the moved term: Perpetual comes back as a choice, never re-selected.
    expect(radio("term", "y1").checked).toBe(true);
    expect(radio("term", "perpetual").disabled).toBe(false);
    choose("term", "perpetual");
    choose("exclusive", "true");
    choose("term", "m6");
    expect(liveLine()?.textContent).toBe("");
  });

  it("a disabled tile says why, with no delta: Perpetual while Exclusive is chosen, Exclusive while others run", () => {
    show(offering());
    choose("exclusive", "true");
    expect(radio("term", "perpetual").disabled).toBe(true);
    expect(tileOf("term", "perpetual")?.textContent).toContain(
      LICENSE_PAGE_COPY.exclusiveTerm,
    );
    expect(deltaOf("term", "perpetual")).toBeNull();
    cleanup();

    show(offering(OTHERS_RUNNING));
    expect(radio("exclusive", "true").disabled).toBe(true);
    const tile = tileOf("exclusive", "true");
    expect(tile?.textContent).toContain(LICENSE_PAGE_COPY.exclusiveUnavailable);
    expect(tile?.textContent).not.toContain(
      LICENSE_PAGE_COPY.licenseType.exclusive.description,
    );
    expect(deltaOf("exclusive", "true")).toBeNull();
    expect(radio("exclusive", "false").checked).toBe(true);
  });

  it("the hold copy says the video waits on the creator only for a manual Exclusive (owner answer Q-173)", () => {
    const line = LICENSE_PAGE_COPY.holdExclusive("maya");
    show(offering());
    expect(document.body.textContent).not.toContain(line);
    choose("exclusive", "true");
    expect(screen.getByText(line).className).toContain("text-callout");
    cleanup();

    show(
      page(
        {},
        {
          autoApprove: true,
          exclusiveEnabled: true,
        },
      ),
    );
    choose("exclusive", "true");
    expect(document.body.textContent).toContain("Instant approval.");
    expect(document.body.textContent).not.toContain(line);
  });
});

describe("Request license (P16a; 05 §4.1 Submit)", () => {
  const NEW_ID = "00000000-0000-4000-8000-000000000999";

  /** Valid details and the terms ticked; Worldwide, so no country is asked for. */
  function fillDetails() {
    choose("territory", "worldwide");
    const type = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    type("Licensed to", "Daily Laughs Media LLC");
    type("Your name", "Sam Lee");
    type("Email", "sam@dailylaughs.com");
    fireEvent.click(screen.getByRole("checkbox"));
  }

  const press = () =>
    act(async () => {
      fireEvent.click(within(bar() as HTMLElement).getByRole("button"));
    });

  const refusal = (code: string, extra: Record<string, unknown> = {}) => ({
    ok: false,
    error: { code, message: "Something went wrong. Try again." },
    ...extra,
  });

  it("checks every field on press, focuses the first problem and sends nothing", async () => {
    show();
    choose("territory", "worldwide");
    await press();
    expect(screen.getByText("Enter who the license is for.")).toBeTruthy();
    expect(
      screen.getByText("Agree to the license and Terms to continue."),
    ).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Licensed to"));
    expect(mocks.startCheckout).not.toHaveBeenCalled();
  });

  it("asks for the country first: a press focuses the select (04 §9.3)", async () => {
    show();
    await press();
    expect(document.activeElement).toBe(screen.getByLabelText("Country"));
    expect(mocks.startCheckout).not.toHaveBeenCalled();
  });

  it("sends the form once with the choice, then waits with the column inert while the page leaves", async () => {
    mocks.startCheckout.mockReturnValue(new Promise(() => {}));
    show();
    fillDetails();
    await press();
    await press();
    expect(mocks.startCheckout).toHaveBeenCalledOnce();
    const data = mocks.startCheckout.mock.calls[0]?.[0] as FormData;
    expect(Object.fromEntries(data)).toMatchObject({
      useKey: "organic_social",
      termKey: "d30",
      territoryKey: "worldwide",
      territoryCode: "",
      licenseeName: "Daily Laughs Media LLC",
      buyerEmail: "sam@dailylaughs.com",
      acceptTerms: "on",
      termsVersion: "v1",
      submissionId: SUBMISSION_ID,
      expectedTotalCents: "28875",
    });
    const button = within(bar() as HTMLElement).getByRole("button");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.textContent).toContain("Starting checkout…");
    expect(
      screen.getByLabelText("Licensed to").closest("[inert]"),
    ).not.toBeNull();
  });

  it("says the new total when the price changed, focuses the banner and refreshes, until another choice (01 J7.10)", async () => {
    mocks.startCheckout.mockResolvedValue(
      refusal("price_changed", { totalCents: 189000 }),
    );
    show();
    fillDetails();
    await press();
    const notice = document.querySelector("[data-license-notice]");
    expect(notice?.textContent).toBe(
      "Prices changed since you opened this page. New total CA$1,890.00.",
    );
    expect(document.activeElement).toBe(notice);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(
      within(bar() as HTMLElement)
        .getByRole("button")
        .getAttribute("aria-busy"),
    ).toBeNull();
    // The total answered the choice it was sent with: a new choice drops it.
    choose("term", "perpetual");
    expect(document.querySelector("[data-license-notice]")).toBeNull();
  });

  it("says a request was already sent (07 D31), and keeps that banner across a new choice", async () => {
    mocks.startCheckout.mockResolvedValue(refusal("already_submitted"));
    show();
    fillDetails();
    await press();
    const text = () =>
      document.querySelector("[data-license-notice]")?.textContent;
    const sent =
      "This request was already sent. Check your email or reload the page.";
    expect(text()).toBe(sent);
    choose("term", "perpetual");
    expect(text()).toBe(sent);
  });

  it("after a failed Checkout, posts a fresh submission until the server renders a newer one", async () => {
    mocks.startCheckout.mockResolvedValue(
      refusal("checkout_failed", { submissionId: NEW_ID }),
    );
    const { rerender } = show();
    fillDetails();
    await press();
    expect(document.querySelector("[data-license-notice]")?.textContent).toBe(
      "Something went wrong. Try again.",
    );
    expect(hidden("submissionId")).toBe(NEW_ID);
    const newer = "11111111-1111-4111-8111-111111111111";
    rerender(<LicensePageClient page={page()} submissionId={newer} />);
    expect(hidden("submissionId")).toBe(newer);
  });

  it("says when the buyer is offline", async () => {
    mocks.startCheckout.mockRejectedValue(new TypeError("Failed to fetch"));
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    show();
    fillDetails();
    await press();
    expect(document.querySelector("[data-license-notice]")?.textContent).toBe(
      "You're offline. Check your connection and try again.",
    );
    online.mockRestore();
  });

  it("shows the server's field errors and focuses the first", async () => {
    mocks.startCheckout.mockResolvedValue(
      refusal("invalid", {
        error: {
          code: "invalid",
          message: "Enter an email address like name@example.com.",
          fields: {
            buyerEmail: ["Enter an email address like name@example.com."],
          },
        },
      }),
    );
    show();
    fillDetails();
    await press();
    expect(
      screen.getByText("Enter an email address like name@example.com."),
    ).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Email"));
  });

  it("moves a group whose option is gone after the refresh, says so and focuses its new choice (01 J7.10)", async () => {
    mocks.startCheckout.mockResolvedValue(refusal("option_disabled"));
    const { rerender } = show();
    choose("use", "paid_social");
    fillDetails();
    await press();
    expect(mocks.refresh).toHaveBeenCalledOnce();
    rerender(
      <LicensePageClient
        page={page({ disabledUses: ["paid_social"] })}
        submissionId={SUBMISSION_ID}
      />,
    );
    expect(radio("use", "organic_social").checked).toBe(true);
    expect(
      screen.getByText("That option isn't available anymore. Choose another."),
    ).toBeTruthy();
    expect(document.activeElement).toBe(radio("use", "organic_social"));
    choose("use", "broadcast");
    expect(
      screen.queryByText(
        "That option isn't available anymore. Choose another.",
      ),
    ).toBeNull();
  });

  /** The refreshed card with 1 year turned off, after a press refused on it. */
  const withoutOneYear = () =>
    page({}, { exclusiveEnabled: true, off: ["y1"] });

  it("a license type chosen after its term moved stays on the moved term, and the line goes", async () => {
    mocks.startCheckout.mockResolvedValue(refusal("option_disabled"));
    const { rerender } = show(offering());
    choose("term", "y1");
    fillDetails();
    await press();
    rerender(
      <LicensePageClient
        page={withoutOneYear()}
        submissionId={SUBMISSION_ID}
      />,
    );
    expect(radio("term", "d30").checked).toBe(true);
    expect(screen.queryByText(LICENSE_PAGE_COPY.optionGone)).not.toBeNull();
    choose("exclusive", "true");
    expect(screen.queryByText(LICENSE_PAGE_COPY.optionGone)).toBeNull();
    expect(radio("term", "d30").checked).toBe(true);
    expect(hidden("termKey")).toBe("d30");
    expect(hidden("exclusive")).toBe("true");
  });

  it("a press empties the term line, so a term the refresh moves again doesn't leave it behind", async () => {
    mocks.startCheckout.mockResolvedValue(refusal("option_disabled"));
    const { rerender } = show(offering());
    fillDetails();
    choose("term", "perpetual");
    choose("exclusive", "true");
    expect(document.querySelector("[data-term-moved]")?.textContent).toBe(
      "Term changed to 1 year. Exclusive licenses last up to 1 year.",
    );
    await press();
    rerender(
      <LicensePageClient
        page={withoutOneYear()}
        submissionId={SUBMISSION_ID}
      />,
    );
    expect(radio("exclusive", "true").checked).toBe(true);
    expect(radio("term", "d30").checked).toBe(true);
    expect(document.querySelector("[data-term-moved]")?.textContent).toBe("");
  });

  it.each(["video_reserved", "licensed_exclusively"])(
    "%s: refreshes, for the server's notice, with no banner",
    async (code) => {
      mocks.startCheckout.mockResolvedValue(refusal(code));
      show();
      fillDetails();
      await press();
      expect(mocks.refresh).toHaveBeenCalledOnce();
      expect(document.querySelector("[data-license-notice]")).toBeNull();
    },
  );

  describe("exclusive_unavailable: the refresh drops Exclusive, and the next press goes on at the standard total", () => {
    const GONE = LICENSE_PAGE_COPY.optionGone;
    const goneLine = () => screen.queryByText(GONE);

    /**
     * Exclusive on the demo selection, or on `term` before the move, or in `country` instead of Worldwide; refused, then
     * the page the refresh brings. Returns what brings a later refresh's page.
     */
    async function refusedExclusive(
      refreshed: LicensePageDTO,
      {
        term = "y1",
        country,
        answer = refusal("exclusive_unavailable"),
      }: {
        term?: string;
        country?: string;
        answer?: ReturnType<typeof refusal>;
      } = {},
    ) {
      mocks.startCheckout.mockResolvedValueOnce(answer);
      const { rerender } = show(offering());
      // Details first: their Worldwide is a new choice, which would empty the term line.
      fillDetails();
      choose("use", "paid_social");
      choose("term", term);
      choose("exclusive", "true");
      expect(hidden("expectedTotalCents")).toBe("519750");
      if (country) {
        choose("territory", "country");
        fireEvent.change(screen.getByLabelText("Country"), {
          target: { value: country },
        });
      }
      await press();
      expect(mocks.refresh).toHaveBeenCalledOnce();
      const refresh = (next: LicensePageDTO) =>
        rerender(
          <LicensePageClient page={next} submissionId={SUBMISSION_ID} />,
        );
      refresh(refreshed);
      return refresh;
    }

    /** A later refresh finds the video open again: the buyer's Standard stands. */
    function expectStaysStandard(refresh: (next: LicensePageDTO) => void) {
      refresh(offering());
      expect(radio("exclusive", "false").checked).toBe(true);
      expect(radio("exclusive", "true").disabled).toBe(false);
      expect(hidden("exclusive")).toBe("false");
    }

    /** What both refreshed pages post: Standard at its total, from the same details. */
    async function expectStandardPosted() {
      expect(hidden("exclusive")).toBe("false");
      expect(hidden("expectedTotalCents")).toBe("173250");
      expect(bar()?.querySelector("[data-price-lines]")?.textContent).toBe(
        "License CA$1,575.00 · Service fee CA$157.50",
      );
      mocks.startCheckout.mockReturnValue(new Promise(() => {}));
      await press();
      const data = mocks.startCheckout.mock.lastCall?.[0] as FormData;
      expect(data.get("exclusive")).toBe("false");
      expect(data.get("expectedTotalCents")).toBe("173250");
    }

    it("the video can't take one now: the group says so and Standard takes the focus", async () => {
      await refusedExclusive(offering(OTHERS_RUNNING));
      const standard = radio("exclusive", "false");
      expect(standard.checked).toBe(true);
      expect(document.activeElement).toBe(standard);
      expect(radio("exclusive", "true").disabled).toBe(true);
      const group = screen.getByRole("group", { name: /^License type\./ });
      expect(group.textContent).toContain(GONE);
      expect(document.querySelector("[data-license-notice]")).toBeNull();
      await expectStandardPosted();
    });

    it("the offer went off: no group, so the banner says so and takes the focus", async () => {
      await refusedExclusive(page());
      expect(
        screen.queryByRole("group", { name: /^License type\./ }),
      ).toBeNull();
      const banner = document.querySelector("[data-license-notice]");
      expect(banner?.textContent).toBe(GONE);
      expect(document.activeElement).toBe(banner);
      await expectStandardPosted();
    });

    it("a new total goes once a refresh drops the Exclusive it was for: the group says so, Standard takes the focus, and the bar is the only total", async () => {
      const refresh = await refusedExclusive(offering(), {
        answer: refusal("price_changed", { totalCents: 693000 }),
      });
      const notice = () => document.querySelector("[data-license-notice]");
      // A refresh that moves nothing leaves it.
      expect(notice()?.textContent).toBe(
        "Prices changed since you opened this page. New total CA$6,930.00.",
      );
      expect(document.activeElement).toBe(notice());

      refresh(offering(OTHERS_RUNNING));
      expect(notice()).toBeNull();
      expect(goneLine()).not.toBeNull();
      expect(document.activeElement).toBe(radio("exclusive", "false"));
      barButton("Request license · CA$1,732.50");
      expect(screen.queryByText(/CA\$6,930/)).toBeNull();
      expect(hidden("expectedTotalCents")).toBe("173250");

      // Over for good: the video opening again brings Exclusive back, not that total's banner.
      refresh(offering());
      expect(notice()).toBeNull();
    });

    it("the term line goes with the Exclusive it spoke for", async () => {
      await refusedExclusive(offering(OTHERS_RUNNING), { term: "perpetual" });
      expect(radio("exclusive", "false").checked).toBe(true);
      expect(radio("term", "y1").checked).toBe(true);
      expect(document.querySelector("[data-term-moved]")?.textContent).toBe("");
    });

    it("a press takes Standard for good: the line goes, and a later refresh keeps the total pressed", async () => {
      const refresh = await refusedExclusive(offering(OTHERS_RUNNING));
      expect(goneLine()).not.toBeNull();
      mocks.startCheckout.mockResolvedValueOnce(
        refusal("price_changed", { totalCents: 173250 }),
      );
      await press();
      expect(goneLine()).toBeNull();
      expectStaysStandard(refresh);
      expect(hidden("expectedTotalCents")).toBe("173250");
      barButton("Request license · CA$1,732.50");
    });

    it("a new choice builds on Standard: the line goes, and Exclusive doesn't come back", async () => {
      const refresh = await refusedExclusive(offering(OTHERS_RUNNING));
      expect(goneLine()).not.toBeNull();
      choose("term", "m6");
      expect(goneLine()).toBeNull();
      expectStaysStandard(refresh);
      expect(hidden("termKey")).toBe("m6");
    });

    it("a new country builds on Standard too", async () => {
      const refresh = await refusedExclusive(offering(OTHERS_RUNNING), {
        country: "US",
      });
      expect(goneLine()).not.toBeNull();
      fireEvent.change(screen.getByLabelText("Country"), {
        target: { value: "FR" },
      });
      expect(goneLine()).toBeNull();
      expectStaysStandard(refresh);
      expect(hidden("territoryCode")).toBe("FR");
    });
  });
});
