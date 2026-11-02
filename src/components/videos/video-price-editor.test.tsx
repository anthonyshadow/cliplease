// @vitest-environment jsdom
import "../../../tests/helpers/postings-fixtures";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setVideoBasePrice,
  setVideoUseEnabled,
} from "@/app/(dashboard)/dashboard/videos/[id]/actions";
import { Toaster } from "@/components/ui/toast";
import { REQUESTS_SETTINGS_COPY } from "@/lib/payouts";
import {
  type ActionResult,
  fieldError,
  formError,
  GENERIC_ERROR_MESSAGE,
} from "@/lib/result";
import { REVIEW_COPY } from "@/lib/videos/review";
import type { MusicUseKey } from "@/lib/videos/rights";
import { VIDEO_PAGE_COPY } from "@/lib/videos/video-page";
import { VIDEO_PRICE_COPY } from "@/lib/videos/video-price";
import { effectiveOptions, type RateCardDTO } from "@/server/pricing/rate-card";
import { VIDEO_ID } from "../../../tests/helpers/postings-fixtures";
import { rateCardFixture } from "../../../tests/helpers/rate-card-fixtures";
import { DraftPricePreview, PriceDraftProvider } from "./price-draft";
import { MusicUseSwitches, VideoPriceEditor } from "./video-price-editor";

const saveBase = vi.mocked(setVideoBasePrice);
const toggleUse = vi.mocked(setVideoUseEnabled);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const RATE_CARD = rateCardFixture();
const WHOLE_DOLLARS = "Use whole dollars.";
const PAID = VIDEO_PRICE_COPY.allowAnyway("paid_social");
const TV = VIDEO_PRICE_COPY.allowAnyway("broadcast");

const optionsOf = ({
  disabledUses = [],
  basePriceOverrideCents = null,
  rateCard = RATE_CARD,
}: {
  disabledUses?: MusicUseKey[];
  basePriceOverrideCents?: number | null;
  rateCard?: RateCardDTO;
} = {}) => effectiveOptions(rateCard, { disabledUses, basePriceOverrideCents });

type EditorProps = ComponentProps<typeof VideoPriceEditor>;

/** The editor over its preview, as Review and the video page place them, with the toasts. */
function editor(change: Partial<EditorProps> = {}) {
  const props: EditorProps = {
    videoId: VIDEO_ID,
    legend: REVIEW_COPY.prices,
    options: optionsOf(),
    rateCard: RATE_CARD,
    containsMusic: false,
    ...change,
  };
  const tree = (p: EditorProps) => (
    <>
      <Toaster />
      <PriceDraftProvider>
        <VideoPriceEditor {...p} />
        <DraftPricePreview options={p.options} platformFeeBps={1000} />
      </PriceDraftProvider>
    </>
  );
  const view = render(tree(props));
  return {
    /** The page's refresh: new props, the same editor. */
    rerender: (next: Partial<EditorProps>) =>
      view.rerender(tree({ ...props, ...next })),
  };
}

const radio = (name: string) =>
  screen.getByRole<HTMLInputElement>("radio", { name });
const rateCardRadio = () => radio("Use my rate card (CA$150)");
const ownRadio = () => radio(VIDEO_PRICE_COPY.setOwn);
const field = () =>
  screen.getByRole<HTMLInputElement>("textbox", {
    name: VIDEO_PRICE_COPY.field,
  });
const noField = () =>
  screen.queryByRole("textbox", { name: VIDEO_PRICE_COPY.field });
const button = (name: string) => screen.getByRole("button", { name });
const noButton = (name: string) => screen.queryByRole("button", { name });
const preview = () =>
  document.querySelector("[data-price-preview]")?.textContent ?? "";
const switchOf = (name: string) => screen.getByRole("switch", { name });
const checked = (name: string) => switchOf(name).getAttribute("aria-checked");

/** An element's accessible description: the text of its aria-describedby ids, in order. */
const description = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent)
    .join(" ");

/** The "Saved." toasts showing: the toast store outlives each test's render, so a test counts the new one. */
const savedToasts = () => screen.queryAllByText(VIDEO_PAGE_COPY.saved).length;

const type = (value: string) =>
  fireEvent.change(field(), { target: { value } });

/** Save, focused first as a press would (jsdom's click doesn't focus). */
function pressSave() {
  const save = button(REVIEW_COPY.save);
  act(() => save.focus());
  fireEvent.click(save);
}

describe("VideoPriceEditor (04 §9.29; 07 D82; owner answers Q-161, Q-162)", () => {
  it("starts on the rate card, named by the section, with no field and nothing to save", () => {
    editor();
    expect(
      screen.getByRole("group", { name: REVIEW_COPY.prices }),
    ).toBeTruthy();
    expect(rateCardRadio().checked).toBe(true);
    expect(ownRadio().checked).toBe(false);
    expect(noField()).toBeNull();
    expect(noButton(REVIEW_COPY.save)).toBeNull();
    expect(noButton(REVIEW_COPY.cancel)).toBeNull();
    expect(preview()).toContain("License CA$1,575.00");
  });

  it("reveals the field on its choice without saving, with Save and Cancel and the unload guard", () => {
    editor();
    fireEvent.click(ownRadio());
    expect(ownRadio().checked).toBe(true);
    expect(field().value).toBe("150");
    expect(field().getAttribute("inputmode")).toBe("decimal");
    expect(description(field())).toBe(
      `CA$ ${REQUESTS_SETTINGS_COPY.newRequestsOnly}`,
    );
    expect(button(REVIEW_COPY.save)).toBeTruthy();
    expect(button(REVIEW_COPY.cancel)).toBeTruthy();
    expect(saveBase).not.toHaveBeenCalled();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it("prices the preview from the typed amount, and Cancel puts back the stored choice and focuses it", () => {
    editor();
    fireEvent.click(ownRadio());
    type("200");
    expect(preview()).toContain(
      "License CA$2,100.00 · Buyer pays CA$2,310.00 (incl. CA$210.00 service fee)",
    );
    // An amount the field refuses leaves the last good one.
    type("9");
    expect(preview()).toContain("License CA$2,100.00");
    const cancel = button(REVIEW_COPY.cancel);
    act(() => cancel.focus());
    fireEvent.click(cancel);
    expect(rateCardRadio().checked).toBe(true);
    expect(noField()).toBeNull();
    expect(noButton(REVIEW_COPY.save)).toBeNull();
    expect(preview()).toContain("License CA$1,575.00");
    expect(document.activeElement).toBe(rateCardRadio());
  });

  it("cancels with Escape in the field", () => {
    editor();
    fireEvent.click(ownRadio());
    type("200");
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(rateCardRadio().checked).toBe(true);
    expect(noField()).toBeNull();
  });

  it.each([
    ["9", "Minimum is CA$10."],
    ["150.50", WHOLE_DOLLARS],
    ["", WHOLE_DOLLARS],
    ["abc", WHOLE_DOLLARS],
    ["10001", "Maximum is CA$10,000."],
  ])(
    "refuses %j under the field without calling the server: %s",
    (typed, message) => {
      editor();
      fireEvent.click(ownRadio());
      type(typed);
      pressSave();
      expect(description(field())).toContain(message);
      expect(field().getAttribute("aria-invalid")).toBe("true");
      expect(document.activeElement).toBe(field());
      expect(saveBase).not.toHaveBeenCalled();
    },
  );

  it("saves the typed whole dollars, says Saved., keeps the price until the refresh, then focuses the choice", async () => {
    saveBase.mockResolvedValue({ ok: true, data: undefined });
    const { rerender } = editor();
    const toasts = savedToasts();
    fireEvent.click(ownRadio());
    type("300");
    pressSave();
    await waitFor(() => expect(savedToasts()).toBe(toasts + 1));
    expect(saveBase).toHaveBeenCalledTimes(1);
    expect(saveBase).toHaveBeenCalledWith({
      videoId: VIDEO_ID,
      basePriceCents: 30000,
    });
    expect(preview()).toContain("License CA$3,150.00");
    rerender({ options: optionsOf({ basePriceOverrideCents: 30000 }) });
    expect(ownRadio().checked).toBe(true);
    expect(field().value).toBe("300");
    expect(noButton(REVIEW_COPY.save)).toBeNull();
    expect(preview()).toContain("License CA$3,150.00");
    expect(document.activeElement).toBe(ownRadio());
  });

  it("with an override stored: its amount, and the rate card saved as null only with Save", async () => {
    saveBase.mockResolvedValue({ ok: true, data: undefined });
    editor({ options: optionsOf({ basePriceOverrideCents: 30000 }) });
    const toasts = savedToasts();
    expect(ownRadio().checked).toBe(true);
    expect(field().value).toBe("300");
    expect(noButton(REVIEW_COPY.save)).toBeNull();
    expect(preview()).toContain("License CA$3,150.00");
    fireEvent.click(rateCardRadio());
    expect(saveBase).not.toHaveBeenCalled();
    expect(noField()).toBeNull();
    expect(preview()).toContain("License CA$1,575.00");
    pressSave();
    await waitFor(() => expect(savedToasts()).toBe(toasts + 1));
    expect(saveBase).toHaveBeenCalledWith({
      videoId: VIDEO_ID,
      basePriceCents: null,
    });
  });

  it("puts the server's refusal under the field and focuses it", async () => {
    saveBase.mockResolvedValue(
      fieldError("invalid_input", "basePriceCents", "Minimum is CA$10."),
    );
    editor();
    fireEvent.click(ownRadio());
    type("300");
    pressSave();
    await waitFor(() =>
      expect(description(field())).toContain("Minimum is CA$10."),
    );
    expect(document.activeElement).toBe(field());
  });

  it("puts a refused rate card under the choices and focuses the checked one (owner answer Q-159)", async () => {
    saveBase.mockResolvedValue(formError("video_disabled"));
    editor({ options: optionsOf({ basePriceOverrideCents: 30000 }) });
    fireEvent.click(rateCardRadio());
    pressSave();
    const group = screen.getByRole("group", { name: REVIEW_COPY.prices });
    await waitFor(() =>
      expect(description(group)).toContain(GENERIC_ERROR_MESSAGE),
    );
    expect(document.activeElement).toBe(rateCardRadio());
  });

  it("clears a refusal once a retried Save goes through", async () => {
    saveBase
      .mockResolvedValueOnce(formError("failed"))
      .mockResolvedValueOnce({ ok: true, data: undefined });
    editor();
    const toasts = savedToasts();
    fireEvent.click(ownRadio());
    type("300");
    pressSave();
    await waitFor(() =>
      expect(description(field())).toContain(GENERIC_ERROR_MESSAGE),
    );
    pressSave();
    await waitFor(() => expect(savedToasts()).toBe(toasts + 1));
    expect(description(field())).not.toContain(GENERIC_ERROR_MESSAGE);
    expect(field().getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("saves nothing on Enter in an unchanged field (owner answer Q-161)", () => {
    editor({ options: optionsOf({ basePriceOverrideCents: 30000 }) });
    const toasts = savedToasts();
    fireEvent.submit(field());
    expect(saveBase).not.toHaveBeenCalled();
    expect(savedToasts()).toBe(toasts);
  });

  it("starts the field from the rate card's base again once the rate card is saved", async () => {
    saveBase.mockResolvedValue({ ok: true, data: undefined });
    const { rerender } = editor({
      options: optionsOf({ basePriceOverrideCents: 30000 }),
    });
    fireEvent.click(rateCardRadio());
    pressSave();
    await waitFor(() => expect(saveBase).toHaveBeenCalledTimes(1));
    rerender({ options: optionsOf() });
    fireEvent.click(ownRadio());
    expect(field().value).toBe("150");
    expect(preview()).toContain("License CA$1,575.00");
  });

  it("keeps a typed amount when the page refreshes with other options (CC-07)", () => {
    const { rerender } = editor({
      containsMusic: true,
      options: optionsOf({ disabledUses: ["broadcast"] }),
    });
    fireEvent.click(ownRadio());
    type("200");
    rerender({ options: optionsOf({ disabledUses: [] }) });
    expect(field().value).toBe("200");
    expect(preview()).toContain("License CA$2,100.00");
    expect(checked(TV)).toBe("true");
  });
});

describe("the music Switches (04 §9.29; 07 D82; owner answer Q-158)", () => {
  it.each([false, null])("shows none while music is %s", (containsMusic) => {
    editor({ containsMusic });
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText(VIDEO_PRICE_COPY.musicHelper)).toBeNull();
  });

  it("shows each as stored, described by the helper once", () => {
    editor({
      containsMusic: true,
      options: optionsOf({ disabledUses: ["broadcast"] }),
    });
    expect([checked(PAID), checked(TV)]).toEqual(["true", "false"]);
    expect(screen.getAllByText(VIDEO_PRICE_COPY.musicHelper)).toHaveLength(1);
    expect(description(switchOf(TV))).toBe(VIDEO_PRICE_COPY.musicHelper);
  });

  it("saves a press at once, ignores presses while it saves, and keeps the saved value until the refresh", async () => {
    const save = Promise.withResolvers<ActionResult>();
    toggleUse.mockReturnValueOnce(save.promise);
    editor({
      containsMusic: true,
      options: optionsOf({ disabledUses: ["broadcast"] }),
    });
    const toasts = savedToasts();
    fireEvent.click(switchOf(TV));
    expect(toggleUse).toHaveBeenCalledWith({
      videoId: VIDEO_ID,
      useKey: "broadcast",
      enabled: true,
    });
    expect(checked(TV)).toBe("true");
    expect(switchOf(TV).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(switchOf(TV));
    expect(toggleUse).toHaveBeenCalledTimes(1);
    expect(checked(TV)).toBe("true");
    await act(async () => save.resolve({ ok: true, data: undefined }));
    expect(savedToasts()).toBe(toasts + 1);
    expect(checked(TV)).toBe("true");
    expect(switchOf(TV).getAttribute("aria-disabled")).toBeNull();
  });

  it("turns a refused press back, says why under it and keeps the focus on it", async () => {
    toggleUse.mockResolvedValueOnce(formError("no_music"));
    editor({
      containsMusic: true,
      options: optionsOf({ disabledUses: ["broadcast"] }),
    });
    fireEvent.click(switchOf(PAID));
    await waitFor(() => expect(checked(PAID)).toBe("true"));
    expect(description(switchOf(PAID))).toBe(
      `${GENERIC_ERROR_MESSAGE} ${VIDEO_PRICE_COPY.musicHelper}`,
    );
    expect(document.activeElement).toBe(switchOf(PAID));
    // The focus is already on the Switch, so the reason is announced.
    expect(screen.getByRole("alert").textContent).toBe(GENERIC_ERROR_MESSAGE);
  });

  it("has no Switch for a use off on the rate card", () => {
    const rateCard = rateCardFixture((o) =>
      o.key === "broadcast" ? { enabled: false } : {},
    );
    editor({
      containsMusic: true,
      rateCard,
      options: optionsOf({
        rateCard,
        disabledUses: ["paid_social", "broadcast"],
      }),
    });
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(screen.queryByRole("switch", { name: TV })).toBeNull();
  });

  it("in a form, posts each through its hidden field and calls no action", () => {
    const onCheckedChange = vi.fn();
    render(
      <form aria-label="Rights">
        <MusicUseSwitches
          mode="form"
          switches={[
            { key: "paid_social", on: false },
            { key: "broadcast", on: true },
          ]}
          onCheckedChange={onCheckedChange}
        />
      </form>,
    );
    const form = screen.getByRole<HTMLFormElement>("form", { name: "Rights" });
    expect([...new FormData(form)]).toEqual([
      ["allowPaidSocial", "off"],
      ["allowBroadcast", "on"],
    ]);
    fireEvent.click(switchOf(PAID));
    expect(onCheckedChange).toHaveBeenCalledWith("paid_social", true);
    expect(toggleUse).not.toHaveBeenCalled();
  });
});
