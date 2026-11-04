// @vitest-environment jsdom
import "../../../tests/helpers/postings-fixtures";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setVideoExclusiveOffer } from "@/app/(dashboard)/dashboard/videos/[id]/actions";
import { Toaster } from "@/components/ui/toast";
import {
  FOLLOWS_RATE_CARD,
  type VideoExclusiveColumns,
} from "@/lib/pricing/exclusive";
import { EXCLUSIVE_COPY } from "@/lib/pricing/exclusive-copy";
import {
  type ActionResult,
  fieldError,
  formError,
  GENERIC_ERROR_MESSAGE,
} from "@/lib/result";
import { REVIEW_COPY } from "@/lib/videos/review";
import { VIDEO_PAGE_COPY } from "@/lib/videos/video-page";
import { VIDEO_PRICE_COPY } from "@/lib/videos/video-price";
import { effectiveOptions, type RateCardDTO } from "@/server/pricing/rate-card";
import {
  button,
  description,
  noButton,
  pressFocused,
  unloadPrevented,
} from "../../../tests/helpers/a11y";
import { VIDEO_ID } from "../../../tests/helpers/postings-fixtures";
import {
  NO_VIDEO,
  rateCardFixture,
} from "../../../tests/helpers/rate-card-fixtures";
import { ExclusiveOfferEditor } from "./exclusive-offer-editor";
import { DraftPricePreview, PriceDraftProvider } from "./price-draft";
import { VideoPriceEditor } from "./video-price-editor";

const saveOffer = vi.mocked(setVideoExclusiveOffer);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SAVED: ActionResult = { ok: true, data: undefined };
const CARD_OFF = rateCardFixture();
const CARD_ON = rateCardFixture(undefined, { exclusiveEnabled: true });
const ON_AT_4: VideoExclusiveColumns = {
  exclusiveEnabled: true,
  exclusiveMultiplierBps: 40000,
};
const ON_AT_5: VideoExclusiveColumns = {
  exclusiveEnabled: true,
  exclusiveMultiplierBps: 50000,
};

// The preview opens on Paid social ads · 1 year · Worldwide: CA$1,575.00 at CA$150.
const LINE_AT_3 = EXCLUSIVE_COPY.line("CA$4,725.00", "CA$5,197.50");
const LINE_AT_4 = EXCLUSIVE_COPY.line("CA$6,300.00", "CA$6,930.00");
const LINE_AT_5 = EXCLUSIVE_COPY.line("CA$7,875.00", "CA$8,662.50");

type Stored = {
  rateCard?: RateCardDTO;
  videoExclusive?: VideoExclusiveColumns;
};

const optionsOf = ({
  rateCard = CARD_OFF,
  videoExclusive = FOLLOWS_RATE_CARD,
}: Stored) => effectiveOptions(rateCard, { ...NO_VIDEO, ...videoExclusive });

/** The editor over its preview, as Review and the video page place them, with the toasts. */
function editor(stored: Stored = {}) {
  const tree = (now: Stored) => {
    const options = optionsOf(now);
    return (
      <>
        <Toaster />
        <PriceDraftProvider>
          <ExclusiveOfferEditor
            videoId={VIDEO_ID}
            options={options}
            rateCard={now.rateCard ?? CARD_OFF}
            videoExclusive={now.videoExclusive ?? FOLLOWS_RATE_CARD}
          />
          <DraftPricePreview options={options} platformFeeBps={1000} />
        </PriceDraftProvider>
      </>
    );
  };
  const view = render(tree(stored));
  return {
    /** The page's refresh: new props, the same editor. */
    rerender: (next: Stored) => view.rerender(tree({ ...stored, ...next })),
  };
}

const radio = (name: string) =>
  screen.getByRole<HTMLInputElement>("radio", { name });
const rateCardOffRadio = () => radio("Use my rate card (off)");
const offerRadio = () => radio(EXCLUSIVE_COPY.offerOnVideo);
const dontOfferRadio = () => radio(EXCLUSIVE_COPY.dontOffer);
const group = () => screen.getByRole("group", { name: EXCLUSIVE_COPY.title });
const field = () =>
  screen.getByRole<HTMLInputElement>("textbox", {
    name: EXCLUSIVE_COPY.videoField,
  });
const noField = () =>
  screen.queryByRole("textbox", { name: EXCLUSIVE_COPY.videoField });
const exclusiveLine = () =>
  document.querySelector("[data-exclusive-line]")?.textContent ?? null;

/** The toasts showing: the toast store outlives each test's render, so a test counts the new one. */
const savedToasts = () => screen.queryAllByText(EXCLUSIVE_COPY.saved).length;

const type = (value: string) =>
  fireEvent.change(field(), { target: { value } });

const pressSave = () => pressFocused(REVIEW_COPY.save);

/** Offer on this video, with `text` in the field. */
function draftOffer(text: string) {
  fireEvent.click(offerRadio());
  type(text);
}

/** Press with the action answering ok, until its toast shows. */
async function savesAfter(press: () => void) {
  saveOffer.mockResolvedValue(SAVED);
  const toasts = savedToasts();
  press();
  await waitFor(() => expect(savedToasts()).toBe(toasts + 1));
}

describe("ExclusiveOfferEditor (04 §9.39; 07 D109, D127; owner answers Q-163, Q-164, Q-166)", () => {
  it("follows a rate card that is off: three radios, the group's helper, no field, nothing to save and no line", () => {
    editor();
    const radios = within(group()).getAllByRole<HTMLInputElement>("radio");
    expect(radios.map((r) => [r.name, r.value])).toEqual([
      ["exclusiveOffer", "rate_card"],
      ["exclusiveOffer", "on"],
      ["exclusiveOffer", "off"],
    ]);
    expect(rateCardOffRadio().checked).toBe(true);
    expect(offerRadio().checked).toBe(false);
    expect(dontOfferRadio().checked).toBe(false);
    expect(group().querySelector("legend")?.className).toContain(
      "text-title-2",
    );
    expect(description(group())).toBe(EXCLUSIVE_COPY.groupHelper);
    expect(noField()).toBeNull();
    expect(noButton(REVIEW_COPY.save)).toBeNull();
    expect(noButton(REVIEW_COPY.cancel)).toBeNull();
    expect(exclusiveLine()).toBeNull();
  });

  it("names a rate card that is on with its premium, and the preview prices at it", () => {
    editor({ rateCard: CARD_ON });
    expect(radio("Use my rate card (on, ×3.00)").checked).toBe(true);
    expect(exclusiveLine()).toBe(LINE_AT_3);
    cleanup();
    editor({
      rateCard: rateCardFixture(undefined, {
        exclusiveEnabled: true,
        exclusiveMultiplierBps: 25000,
      }),
    });
    expect(radio("Use my rate card (on, ×2.50)").checked).toBe(true);
  });

  it("reveals the empty premium on its choice without saving, with Save and Cancel, the unload guard and the card's premium", () => {
    editor();
    fireEvent.click(offerRadio());
    expect(offerRadio().checked).toBe(true);
    expect(saveOffer).not.toHaveBeenCalled();
    expect(field().value).toBe("");
    expect(field().getAttribute("inputmode")).toBe("decimal");
    expect(description(field())).toBe(
      "× Leave empty to use your rate card's ×3.00.",
    );
    expect(button(REVIEW_COPY.save)).toBeTruthy();
    expect(button(REVIEW_COPY.cancel)).toBeTruthy();
    expect(exclusiveLine()).toBe(LINE_AT_3);
    expect(unloadPrevented()).toBe(true);
  });

  it("prices the preview from the typed premium, and Cancel puts back the stored choice and focuses it", () => {
    editor();
    draftOffer("4.00");
    expect(exclusiveLine()).toBe(LINE_AT_4);
    // A premium the field refuses leaves the last good one; an empty field is the card's.
    type("0.95");
    expect(exclusiveLine()).toBe(LINE_AT_4);
    type("");
    expect(exclusiveLine()).toBe(LINE_AT_3);
    pressFocused(REVIEW_COPY.cancel);
    expect(rateCardOffRadio().checked).toBe(true);
    expect(noField()).toBeNull();
    expect(noButton(REVIEW_COPY.save)).toBeNull();
    expect(exclusiveLine()).toBeNull();
    expect(document.activeElement).toBe(rateCardOffRadio());
  });

  it("drafts the choice without a line while Don't offer is chosen", () => {
    editor({ rateCard: CARD_ON });
    fireEvent.click(dontOfferRadio());
    expect(saveOffer).not.toHaveBeenCalled();
    expect(noField()).toBeNull();
    expect(button(REVIEW_COPY.save)).toBeTruthy();
    expect(exclusiveLine()).toBeNull();
  });

  /** Both editors over the preview, as Review and the video page place them, with both drafted. */
  function bothDirty() {
    const options = optionsOf({ rateCard: CARD_ON });
    render(
      <PriceDraftProvider>
        <VideoPriceEditor
          videoId={VIDEO_ID}
          legend={REVIEW_COPY.prices}
          options={options}
          rateCard={CARD_ON}
          containsMusic={false}
        />
        <ExclusiveOfferEditor
          videoId={VIDEO_ID}
          options={options}
          rateCard={CARD_ON}
          videoExclusive={FOLLOWS_RATE_CARD}
        />
        <DraftPricePreview options={options} platformFeeBps={1000} />
      </PriceDraftProvider>,
    );
    fireEvent.click(radio(VIDEO_PRICE_COPY.setOwn));
    fireEvent.change(
      screen.getByRole("textbox", { name: VIDEO_PRICE_COPY.field }),
      { target: { value: "300" } },
    );
    fireEvent.click(offerRadio());
  }

  it("combines with the base price draft of the editor above it", () => {
    bothDirty();
    expect(exclusiveLine()).toBe(
      EXCLUSIVE_COPY.line("CA$9,450.00", "CA$10,395.00"),
    );
  });

  it.each([
    [
      "the exclusive editor, then the base price",
      "[data-exclusive-offer-editor]",
      "[data-video-price-editor]",
    ],
    [
      "the base price, then the exclusive editor",
      "[data-video-price-editor]",
      "[data-exclusive-offer-editor]",
    ],
  ])(
    "keeps asking before leaving until both are clean: %s",
    (_, first, second) => {
      const cancel = (root: string) => {
        const editorRoot = document.querySelector<HTMLElement>(root);
        if (!editorRoot) throw new Error(`Nothing renders ${root}`);
        fireEvent.click(
          within(editorRoot).getByRole("button", { name: REVIEW_COPY.cancel }),
        );
      };
      bothDirty();
      expect(unloadPrevented()).toBe(true);
      cancel(first);
      expect(unloadPrevented()).toBe(true);
      cancel(second);
      expect(unloadPrevented()).toBe(false);
    },
  );

  it.each([
    ["0.95", "Minimum is ×1.00."],
    ["10.05", "Maximum is ×10.00."],
    ["3.33", "Use steps of 0.05."],
    ["abc", "Use steps of 0.05."],
  ])(
    "refuses %j under the field without calling the server: %s",
    (typed, message) => {
      editor();
      draftOffer(typed);
      pressSave();
      expect(description(field())).toContain(message);
      expect(field().getAttribute("aria-invalid")).toBe("true");
      expect(document.activeElement).toBe(field());
      expect(saveOffer).not.toHaveBeenCalled();
    },
  );

  it.each<
    [
      string,
      VideoExclusiveColumns,
      () => void,
      Omit<Parameters<typeof setVideoExclusiveOffer>[0], "videoId">,
    ]
  >([
    [
      "Offer with an empty field as null",
      FOLLOWS_RATE_CARD,
      () => fireEvent.click(offerRadio()),
      { mode: "on", multiplierBps: null },
    ],
    [
      'Offer at "4" as 40000',
      FOLLOWS_RATE_CARD,
      () => draftOffer("4"),
      { mode: "on", multiplierBps: 40000 },
    ],
    [
      "Don't offer as null",
      FOLLOWS_RATE_CARD,
      () => fireEvent.click(dontOfferRadio()),
      { mode: "off", multiplierBps: null },
    ],
    [
      "the rate card again as null",
      ON_AT_4,
      () => fireEvent.click(rateCardOffRadio()),
      { mode: "rate_card", multiplierBps: null },
    ],
  ])(
    "saves %s, once, and says so in its own words",
    async (_name, videoExclusive, draft, saved) => {
      editor({ videoExclusive });
      draft();
      expect(saveOffer).not.toHaveBeenCalled();
      await savesAfter(pressSave);
      expect(saveOffer).toHaveBeenCalledTimes(1);
      expect(saveOffer).toHaveBeenCalledWith({ videoId: VIDEO_ID, ...saved });
      expect(screen.queryByText(VIDEO_PAGE_COPY.saved)).toBeNull();
    },
  );

  it("shows a stored premium with nothing to save, spaces changing nothing, and clearing it saves null", async () => {
    editor({ videoExclusive: ON_AT_4 });
    expect(offerRadio().checked).toBe(true);
    expect(field().value).toBe("4.00");
    expect(noButton(REVIEW_COPY.save)).toBeNull();
    expect(noButton(REVIEW_COPY.cancel)).toBeNull();
    type(" 4.00 ");
    expect(noButton(REVIEW_COPY.save)).toBeNull();
    type("");
    expect(exclusiveLine()).toBe(LINE_AT_3);
    await savesAfter(pressSave);
    expect(saveOffer).toHaveBeenCalledWith({
      videoId: VIDEO_ID,
      mode: "on",
      multiplierBps: null,
    });
  });

  it('shows "4" saved as the refreshed page will', async () => {
    saveOffer.mockResolvedValue(SAVED);
    const { rerender } = editor();
    draftOffer("4");
    pressSave();
    await waitFor(() => expect(field().value).toBe("4.00"));
    rerender({ videoExclusive: ON_AT_4 });
    expect(field().value).toBe("4.00");
    expect(noButton(REVIEW_COPY.save)).toBeNull();
  });

  it("puts the server's refusal under the field, focuses it and announces it", async () => {
    const message = "Maximum is ×10.00.";
    saveOffer.mockResolvedValue(
      fieldError("invalid_input", "multiplierBps", message),
    );
    editor();
    draftOffer("4");
    pressSave();
    await waitFor(() => expect(description(field())).toContain(message));
    expect(document.activeElement).toBe(field());
    expect(screen.getByRole("alert").textContent).toBe(message);
  });

  it("puts a refusal with no field under the choices and focuses the checked one; a new choice clears it (owner answer Q-159)", async () => {
    saveOffer.mockResolvedValue(formError("video_disabled"));
    editor();
    fireEvent.click(dontOfferRadio());
    pressSave();
    await waitFor(() =>
      expect(description(group())).toContain(GENERIC_ERROR_MESSAGE),
    );
    expect(document.activeElement).toBe(dontOfferRadio());
    expect(screen.getByRole("alert").textContent).toBe(GENERIC_ERROR_MESSAGE);
    fireEvent.click(offerRadio());
    expect(description(group())).toBe(EXCLUSIVE_COPY.groupHelper);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("saves on Enter in the field", async () => {
    editor();
    draftOffer("4");
    await savesAfter(() => fireEvent.submit(field()));
    expect(saveOffer).toHaveBeenCalledWith({
      videoId: VIDEO_ID,
      mode: "on",
      multiplierBps: 40000,
    });
  });

  it("saves nothing on Enter in an unchanged field", () => {
    editor({ videoExclusive: ON_AT_4 });
    const toasts = savedToasts();
    fireEvent.submit(field());
    expect(saveOffer).not.toHaveBeenCalled();
    expect(savedToasts()).toBe(toasts);
  });

  it("cancels with Escape in the field", () => {
    editor();
    draftOffer("4");
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(rateCardOffRadio().checked).toBe(true);
    expect(noField()).toBeNull();
    expect(saveOffer).not.toHaveBeenCalled();
  });

  it("locks the choices while it saves, and Escape waits for the save", async () => {
    const save = Promise.withResolvers<ActionResult>();
    saveOffer.mockReturnValueOnce(save.promise);
    editor();
    draftOffer("4");
    pressSave();
    await waitFor(() => expect(rateCardOffRadio().disabled).toBe(true));
    expect(offerRadio().disabled).toBe(true);
    expect(dontOfferRadio().disabled).toBe(true);
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(offerRadio().checked).toBe(true);
    expect(field().value).toBe("4");
    await act(async () => save.resolve(SAVED));
    expect(offerRadio().disabled).toBe(false);
    expect(field().value).toBe("4.00");
  });

  it("keeps what was typed while the save was in flight", async () => {
    const save = Promise.withResolvers<ActionResult>();
    saveOffer.mockReturnValueOnce(save.promise);
    editor();
    draftOffer("4");
    pressSave();
    type("5");
    await act(async () => save.resolve(SAVED));
    expect(field().value).toBe("5");
    expect(exclusiveLine()).toBe(LINE_AT_5);
  });

  it("says a 30-day, 6-month or 1-year term must be on, whichever is chosen, with the tiles enabled and no line", () => {
    const rateCard = rateCardFixture(
      (o) => (["d30", "m6", "y1"].includes(o.key) ? { enabled: false } : {}),
      { exclusiveEnabled: true },
    );
    editor({ rateCard });
    const tiles = within(group()).getAllByRole<HTMLInputElement>("radio");
    expect(tiles).toHaveLength(3);
    for (const tile of tiles) {
      fireEvent.click(tile);
      expect(tile.checked).toBe(true);
      expect(tile.disabled).toBe(false);
      expect(description(group())).toBe(
        `${EXCLUSIVE_COPY.groupHelper} ${EXCLUSIVE_COPY.noExclusiveTerm}`,
      );
      expect(exclusiveLine()).toBeNull();
    }
  });

  it("while clean, follows what the refresh brings", () => {
    const { rerender } = editor();
    rerender({ videoExclusive: ON_AT_4 });
    expect(offerRadio().checked).toBe(true);
    expect(field().value).toBe("4.00");
    expect(noButton(REVIEW_COPY.save)).toBeNull();
    expect(exclusiveLine()).toBe(LINE_AT_4);
    rerender({ videoExclusive: FOLLOWS_RATE_CARD });
    expect(rateCardOffRadio().checked).toBe(true);
    expect(noField()).toBeNull();
    expect(exclusiveLine()).toBeNull();
  });

  it.each([
    ["on the first render", false],
    ["after a refresh that changed nothing", true],
  ])(
    "follows the refresh after an Escape with nothing to cancel, %s",
    (_, refreshed) => {
      const { rerender } = editor({ videoExclusive: ON_AT_4 });
      if (refreshed) rerender({ videoExclusive: ON_AT_4 });
      fireEvent.keyDown(field(), { key: "Escape" });
      rerender({ videoExclusive: ON_AT_5 });
      expect(field().value).toBe("5.00");
      expect(noButton(REVIEW_COPY.save)).toBeNull();
      expect(unloadPrevented()).toBe(false);
      expect(exclusiveLine()).toBe(LINE_AT_5);
    },
  );

  it("keeps a draft in progress when the refresh brings something else", () => {
    const { rerender } = editor();
    draftOffer("5");
    rerender({ videoExclusive: ON_AT_4 });
    expect(offerRadio().checked).toBe(true);
    expect(field().value).toBe("5");
    expect(button(REVIEW_COPY.save)).toBeTruthy();
    expect(exclusiveLine()).toBe(LINE_AT_5);
  });

  it("keeps the saved draft until the refresh, then is clean, focuses the choice and the preview reads the video's offer", async () => {
    const { rerender } = editor();
    draftOffer("4");
    await savesAfter(pressSave);
    expect(exclusiveLine()).toBe(LINE_AT_4);
    rerender({ videoExclusive: ON_AT_4 });
    expect(noButton(REVIEW_COPY.save)).toBeNull();
    expect(document.activeElement).toBe(offerRadio());
    expect(exclusiveLine()).toBe(LINE_AT_4);
    rerender({ videoExclusive: ON_AT_5 });
    expect(exclusiveLine()).toBe(LINE_AT_5);
  });

  it("drafts nothing while clean: the preview reads its own options' offer", () => {
    render(
      <PriceDraftProvider>
        <ExclusiveOfferEditor
          videoId={VIDEO_ID}
          options={optionsOf({ videoExclusive: ON_AT_4 })}
          rateCard={CARD_OFF}
          videoExclusive={ON_AT_4}
        />
        <DraftPricePreview
          options={optionsOf({ videoExclusive: ON_AT_5 })}
          platformFeeBps={1000}
        />
      </PriceDraftProvider>,
    );
    expect(exclusiveLine()).toBe(LINE_AT_5);
  });
});
