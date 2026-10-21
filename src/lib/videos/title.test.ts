import { describe, expect, it } from "vitest";
import { TITLE_COPY, TITLE_MAX, tidyTitle, titleMessage } from "./title";

describe("tidyTitle (owner answer Q-43 a)", () => {
  it("tidies a title as ../text/tidy does", () => {
    expect(tidyTitle(" First\u202e\u200b  snow\n")).toBe("First snow");
    expect(tidyTitle("\u200b \u3164")).toBe("");
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
    "\u200b",
    "\u3164 \u3164",
    "\u2800",
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
