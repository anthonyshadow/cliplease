import { describe, expect, it } from "vitest";
import { TITLE_COPY, TITLE_MAX, tidyTitle, titleMessage } from "./title";

describe("tidyTitle (owner answer Q-43 a)", () => {
  it.each([
    ["Fir\u200bst snow", "First snow"],
    ["\ufeffFirst snow", "First snow"],
    ["First\u2060 snow", "First snow"],
    ["Fir\u00adst snow", "First snow"],
  ])("removes characters that only hide: %j → %j", (raw, tidy) => {
    expect(tidyTitle(raw)).toBe(tidy);
  });

  it.each([
    "\u200b",
    "\u200b \u200b",
    "\u200d",
    "\u200c\u200d",
    "\u2063",
    "\u3164",
    "\u3164 \u3164",
    "\u2800",
    "\uffa0",
    "\u034f",
    "\ufe0f",
    "\u115f\u1160",
    "\u180e",
    "\u2062",
  ])("is empty when nothing visible is left: %j", (raw) => {
    expect(tidyTitle(raw)).toBe("");
    expect(titleMessage(raw)).toBe(TITLE_COPY.empty);
  });

  it("keeps the joiners an emoji sequence needs", () => {
    const family = "Family \u{1f468}\u200d\u{1f469}\u200d\u{1f467} day";
    expect(tidyTitle(family)).toBe(family);
  });

  it.each([
    "Love \u2764\ufe0f",
    "Trip \u{1f3f4}\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}",
    "\uc548\ub155 \ud558\uc138\uc694",
  ])("keeps what a visible title needs: %j", (raw) => {
    expect(tidyTitle(raw)).toBe(raw);
  });

  it.each([
    ["First\tsnow", "First snow"],
    ["First\nsnow", "First snow"],
    ["First\r\nsnow", "First snow"],
    ["First\rsnow", "First snow"],
    ["First\u2028snow", "First snow"],
    ["First\u2029snow", "First snow"],
    ["First\v\fsnow", "First snow"],
    // NEL is a line break too.
    ["First\u0085snow", "First snow"],
  ])("turns line breaks and tabs into spaces: %j → %j", (raw, tidy) => {
    expect(tidyTitle(raw)).toBe(tidy);
  });

  it.each([
    ["First \u202esnow", "First snow"],
    ["\u2066First snow\u2069", "First snow"],
    ["First snow\u200f", "First snow"],
    ["Fir\u0000st snow", "First snow"],
    ["Fir\u007fst snow", "First snow"],
    ["Fir\u001bst snow", "First snow"],
    ["Fir\u009bst snow", "First snow"],
    ["\u061cFirst\u200e snow\u202a", "First snow"],
    ["\u0085First snow\u0085", "First snow"],
  ])("removes control and direction marks: %j → %j", (raw, tidy) => {
    expect(tidyTitle(raw)).toBe(tidy);
  });

  it.each([
    ["  First   snow  ", "First snow"],
    ["First \t\n snow", "First snow"],
    ["First\u00a0\u00a0snow", "First snow"],
    ["\n\nFirst snow\n\n", "First snow"],
    ["First \u202e snow", "First snow"],
  ])("collapses whitespace runs and trims: %j → %j", (raw, tidy) => {
    expect(tidyTitle(raw)).toBe(tidy);
  });

  it("keeps an already tidy title as is", () => {
    expect(tidyTitle("Café Déjà Vu 🐶")).toBe("Café Déjà Vu 🐶");
    expect(tidyTitle(tidyTitle(" a\t\u202eb\n "))).toBe(
      tidyTitle(" a\t\u202eb\n "),
    );
  });
});

describe("titleMessage (owner answer Q-40)", () => {
  it.each([
    "",
    "   ",
    "\t\n\r",
    "\u202e\u2066\u200f",
    "\u0000\u007f\u0085",
    " \u2028 ",
  ])("%j → Add a title.", (raw) => {
    expect(titleMessage(raw)).toBe("Add a title.");
  });

  it.each(["x".repeat(TITLE_MAX + 1), ` ${"x".repeat(150)} `])(
    "a long title → Keep it to 100 characters.",
    (raw) => {
      expect(titleMessage(raw)).toBe("Keep it to 100 characters.");
    },
  );
});

describe("title limits and copy (07 D23)", () => {
  it("allows 1 to 100 characters", () => {
    expect(TITLE_MAX).toBe(100);
  });

  it("keeps the Q-40 strings", () => {
    expect(TITLE_COPY).toEqual({
      empty: "Add a title.",
      long: "Keep it to 100 characters.",
    });
  });
});
