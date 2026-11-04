// @vitest-environment jsdom
import "../../../../../tests/helpers/postings-fixtures";
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
import { TERM_OPTIONS } from "@/lib/licensing/options";
import { EXCLUSIVE_COPY } from "@/lib/pricing/exclusive-copy";
import { fieldErrors } from "@/lib/result";
import { defaultRateCardInput } from "@/lib/validation/pricing";
import type { RateCardDTO } from "@/server/pricing/rate-card";
import {
  button,
  description,
  pressFocused,
  unloadPrevented,
} from "../../../../../tests/helpers/a11y";
import { rateCardFixture } from "../../../../../tests/helpers/rate-card-fixtures";
import { saveRateCard } from "./actions";
import { RateCardEditor } from "./rate-card-editor";

vi.mock("./actions", () => ({ saveRateCard: vi.fn() }));

const save = vi.mocked(saveRateCard);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SAVE = "Save prices";
const OK = { ok: true, data: undefined } as const;
const MINIMUM = "Minimum is ×1.00.";
const MAXIMUM = "Maximum is ×10.00.";
const STEPS = "Use steps of 0.05.";
const ON_AT_2_50 = rateCardFixture(undefined, {
  exclusiveEnabled: true,
  exclusiveMultiplierBps: 25000,
});

const editor = (card: RateCardDTO = rateCardFixture()) =>
  render(<RateCardEditor card={card} platformFeeBps={1000} />);

const section = () => screen.getByRole("group", { name: EXCLUSIVE_COPY.title });
const offerSwitch = () =>
  screen.getByRole("switch", { name: EXCLUSIVE_COPY.offerSwitch });
const premium = () =>
  screen.getByRole<HTMLInputElement>("textbox", {
    name: EXCLUSIVE_COPY.premiumLabel,
  });
const noPremium = () =>
  screen.queryByRole("textbox", { name: EXCLUSIVE_COPY.premiumLabel });
const examplePrice = () => document.querySelector("[data-example-price]");
const line = () => document.querySelector("[data-exclusive-line]");

const toggleOffer = () => fireEvent.click(offerSwitch());
const type = (value: string) =>
  fireEvent.change(premium(), { target: { value } });
const turnOffTerm = (label: string) =>
  fireEvent.click(screen.getByRole("switch", { name: label }));

const pressSave = () => pressFocused(SAVE);

/** The editor with the offer switched on. */
function editorOn() {
  editor();
  toggleOffer();
}

/** Save with the action answering ok, until the form holds what came back. */
async function saveOk() {
  save.mockResolvedValueOnce(OK);
  pressSave();
  await waitFor(() =>
    expect(button(SAVE).getAttribute("aria-busy")).toBeNull(),
  );
}

describe("RateCardEditor's Exclusive licenses section (04 §9.29; 07 D109; AD-46, AD-47)", () => {
  it("starts off: a group with its Switch and helper, no premium and no line", () => {
    editor();
    expect(offerSwitch().getAttribute("aria-checked")).toBe("false");
    expect(within(section()).getByRole("switch")).toBe(offerSwitch());
    expect(description(offerSwitch())).toBe(EXCLUSIVE_COPY.offerSwitchHelper);
    expect(noPremium()).toBeNull();
    expect(examplePrice()).toBeNull();
    expect(line()).toBeNull();
  });

  it("switched on: the field at 3.00, its helper, the example price and the preview's line, with the helper unchanged", () => {
    editorOn();
    expect(offerSwitch().getAttribute("aria-checked")).toBe("true");
    expect(description(offerSwitch())).toBe(EXCLUSIVE_COPY.offerSwitchHelper);
    expect(premium().value).toBe("3.00");
    expect(description(premium())).toBe(`× ${EXCLUSIVE_COPY.premiumHelper}`);
    expect(examplePrice()?.textContent).toBe("CA$450.00");
    expect(line()?.textContent).toBe(
      EXCLUSIVE_COPY.line("CA$4,725.00", "CA$5,197.50"),
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("reprices on every keystroke", () => {
    editorOn();
    type("4.00");
    expect(line()?.textContent).toBe(
      EXCLUSIVE_COPY.line("CA$6,300.00", "CA$6,930.00"),
    );
    expect(examplePrice()?.textContent).toBe("CA$600.00");
  });

  it.each(["3.", "0.95", "", "abc", "10.05", "3.33"])(
    "keeps the last valid prices while the field reads %j",
    (text) => {
      editorOn();
      type("4.00");
      type(text);
      expect(premium().value).toBe(text);
      expect(line()?.textContent).toBe(
        EXCLUSIVE_COPY.line("CA$6,300.00", "CA$6,930.00"),
      );
      expect(examplePrice()?.textContent).toBe("CA$600.00");
    },
  );

  it("adds the no-term line, with no example or preview line, when only Perpetual is on, and Save stays allowed", async () => {
    editorOn();
    turnOffTerm(TERM_OPTIONS.d30.label);
    turnOffTerm(TERM_OPTIONS.m6.label);
    expect(screen.queryByText(EXCLUSIVE_COPY.noExclusiveTerm)).toBeNull();
    turnOffTerm(TERM_OPTIONS.y1.label);
    expect(screen.getByText(EXCLUSIVE_COPY.noExclusiveTerm)).toBeTruthy();
    expect(description(premium())).toBe(
      `× ${EXCLUSIVE_COPY.premiumHelper} ${EXCLUSIVE_COPY.noExclusiveTerm}`,
    );
    expect(examplePrice()?.textContent).toBe("");
    expect(line()).toBeNull();
    await saveOk();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      exclusiveEnabled: true,
      exclusiveMultiplierBps: 30000,
    });
  });

  it("prices the example at the first exclusive term that is on", () => {
    editorOn();
    turnOffTerm(TERM_OPTIONS.d30.label);
    // Organic ×1.00, 6 months ×1.50, one country ×1.00, ×3.00.
    expect(examplePrice()?.textContent).toBe("CA$675.00");
  });

  it("starts on, at the stored premium, from a card that has them", () => {
    editor(ON_AT_2_50);
    expect(offerSwitch().getAttribute("aria-checked")).toBe("true");
    expect(premium().value).toBe("2.50");
    expect(line()?.textContent).toBe(
      EXCLUSIVE_COPY.line("CA$3,937.50", "CA$4,331.25"),
    );
  });

  it("sends the switch and the typed premium on Save", async () => {
    editorOn();
    type("4.00");
    await saveOk();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      exclusiveEnabled: true,
      exclusiveMultiplierBps: 40000,
    });
  });
});

describe("RateCardEditor's premium errors (owner answer Q-91)", () => {
  it.each([
    ["0.95", MINIMUM],
    ["3.33", STEPS],
    ["10.05", MAXIMUM],
    ["abc", STEPS],
  ])(
    "Save with %j says %j under the field, focuses it and calls nothing",
    (text, message) => {
      editorOn();
      type(text);
      pressSave();
      expect(screen.getByText(message)).toBeTruthy();
      expect(premium().getAttribute("aria-invalid")).toBe("true");
      expect(description(premium())).toContain(message);
      expect(document.activeElement).toBe(premium());
      expect(save).not.toHaveBeenCalled();
    },
  );

  it("clears the error as the field changes", () => {
    editorOn();
    type("0.95");
    pressSave();
    type("1.00");
    expect(screen.queryByText(MINIMUM)).toBeNull();
    expect(premium().getAttribute("aria-invalid")).toBeNull();
  });

  it("focuses the first error in page order: the premium comes last", () => {
    editorOn();
    type("0.95");
    fireEvent.change(screen.getByRole("textbox", { name: "Base price" }), {
      target: { value: "5" },
    });
    pressSave();
    expect(screen.getByText(MINIMUM)).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Base price" }),
    );
  });

  it("puts the server's premium refusal under the field and focuses it", async () => {
    editorOn();
    save.mockResolvedValueOnce(
      fieldErrors("invalid_input", [["exclusiveMultiplierBps", MAXIMUM]]),
    );
    pressSave();
    await screen.findByText(MAXIMUM);
    expect(description(premium())).toContain(MAXIMUM);
    await waitFor(() => expect(document.activeElement).toBe(premium()));
  });
});

describe("RateCardEditor's refused Enter (the focus is already on the field)", () => {
  const pressEnter = () => {
    act(() => premium().focus());
    const form = premium().closest("form");
    if (!form) throw new Error("The premium field has no form");
    fireEvent.submit(form);
  };

  it("announces it, and announces a repeat again", () => {
    editorOn();
    type("0.95");
    pressEnter();
    const first = screen.getByRole("alert");
    expect(first.textContent).toBe(MINIMUM);
    expect(document.activeElement).toBe(premium());
    pressEnter();
    const second = screen.getByRole("alert");
    expect(second.textContent).toBe(MINIMUM);
    expect(second).not.toBe(first);
    expect(save).not.toHaveBeenCalled();
  });

  it("drops the alert on the next edit", () => {
    editorOn();
    type("0.95");
    pressEnter();
    expect(screen.getByRole("alert")).toBeTruthy();
    type("4");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stays silent when the focus moves, which says it through the field's description", () => {
    editorOn();
    type("0.95");
    pressSave();
    expect(document.activeElement).toBe(premium());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("RateCardEditor's hidden premium (AD-46)", () => {
  /** On, a premium the bounds refuse, then off. */
  function hideBadPremium() {
    toggleOffer();
    type("0.95");
    toggleOffer();
  }

  it("Save with the row hidden sends the stored premium, not the hidden text, and shows no error", async () => {
    editor();
    hideBadPremium();
    await saveOk();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      exclusiveEnabled: false,
      exclusiveMultiplierBps: 30000,
    });
    expect(screen.queryByText(MINIMUM)).toBeNull();
  });

  it("sends the stored premium, not a valid one typed and then hidden", async () => {
    editorOn();
    type("4.00");
    toggleOffer();
    await saveOk();
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      exclusiveEnabled: false,
      exclusiveMultiplierBps: 30000,
    });
  });

  it("keeps what was typed while a Save was in flight, still asks before leaving, and then hides the premium that Save stored", async () => {
    const saving = Promise.withResolvers<typeof OK>();
    save.mockReturnValueOnce(saving.promise);
    editorOn();
    type("4");
    pressSave();
    type("5");
    await act(async () => saving.resolve(OK));
    expect(premium().value).toBe("5");
    expect(unloadPrevented()).toBe(true);
    toggleOffer();
    await saveOk();
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      exclusiveEnabled: false,
      exclusiveMultiplierBps: 40000,
    });
  });

  it("brings the typed text back, with no error, on switching on again before a save", () => {
    editor();
    hideBadPremium();
    toggleOffer();
    expect(premium().value).toBe("0.95");
    expect(screen.queryByText(MINIMUM)).toBeNull();
  });

  it("drops the shown error on switching off, and doesn't bring it back", () => {
    editorOn();
    type("0.95");
    pressSave();
    expect(screen.getByText(MINIMUM)).toBeTruthy();
    toggleOffer();
    expect(screen.queryByText(MINIMUM)).toBeNull();
    toggleOffer();
    expect(premium().value).toBe("0.95");
    expect(screen.queryByText(MINIMUM)).toBeNull();
  });

  it("replaces the hidden text with the stored premium after the save", async () => {
    editor();
    hideBadPremium();
    await saveOk();
    toggleOffer();
    expect(premium().value).toBe("3.00");
  });

  it("sends the card's own stored premium while hidden, and the one saved after it", async () => {
    editor(ON_AT_2_50);
    toggleOffer();
    await saveOk();
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      exclusiveEnabled: false,
      exclusiveMultiplierBps: 25000,
    });
    toggleOffer();
    type("4.00");
    await saveOk();
    toggleOffer();
    await saveOk();
    expect(save.mock.calls[2]?.[0]).toMatchObject({
      exclusiveEnabled: false,
      exclusiveMultiplierBps: 40000,
    });
  });

  it("guards the unload only for a change Save would store: a hidden premium isn't one", () => {
    editor();
    expect(unloadPrevented()).toBe(false);
    toggleOffer();
    expect(unloadPrevented()).toBe(true);
    type("4.00");
    toggleOffer();
    expect(unloadPrevented()).toBe(false);
  });
});

describe("RateCardEditor's Reset to defaults (owner answers Q-92, Q-165; AD-48)", () => {
  const SHEET_SENTENCE =
    "Your base price goes back to CA$150, every option to its default, switched on, and exclusive licenses off at ×3.00. New requests only.";

  function openReset() {
    fireEvent.click(button("Reset to defaults"));
    return screen.getByRole("alertdialog");
  }

  function confirmReset() {
    fireEvent.click(
      within(openReset()).getByRole("button", { name: "Reset prices" }),
    );
  }

  it("asks with the sentence that names the exclusive offer", () => {
    editor();
    const sheet = openReset();
    expect(within(sheet).getByText(SHEET_SENTENCE)).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  it("saves the default card and turns a stored offer off at ×3.00", async () => {
    editor(ON_AT_2_50);
    expect(premium().value).toBe("2.50");
    save.mockResolvedValueOnce(OK);
    confirmReset();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(save).toHaveBeenCalledExactlyOnceWith(defaultRateCardInput("cad"));
    expect(offerSwitch().getAttribute("aria-checked")).toBe("false");
    expect(noPremium()).toBeNull();
    toggleOffer();
    expect(premium().value).toBe("3.00");
  });

  it("fills the form even when a Save in flight rewrote it while the sheet was open", async () => {
    let finishSave: (value: typeof OK) => void = () => {};
    let finishReset: (value: typeof OK) => void = () => {};
    save
      .mockReturnValueOnce(new Promise((resolve) => (finishSave = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (finishReset = resolve)));
    editorOn();
    type("4");
    pressSave();
    confirmReset();
    await act(async () => finishSave(OK));
    // The Save normalized the form ("4" → "4.00") before the Reset came back; the open sheet hides the page from roles.
    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: EXCLUSIVE_COPY.premiumLabel,
        hidden: true,
      }).value,
    ).toBe("4.00");
    await act(async () => finishReset(OK));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(offerSwitch().getAttribute("aria-checked")).toBe("false");
    expect(noPremium()).toBeNull();
    expect(line()).toBeNull();
    toggleOffer();
    expect(premium().value).toBe("3.00");
  });
});
