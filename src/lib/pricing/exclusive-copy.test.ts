import { describe, expect, it } from "vitest";
import { EXCLUSIVE_COPY } from "./exclusive-copy";

describe("EXCLUSIVE_COPY's filled-in lines (04 §9.29, §9.39; owner answers Q-164, Q-165)", () => {
  it("says what the rate card offers", () => {
    expect(EXCLUSIVE_COPY.useRateCard(true, 30000)).toBe(
      "Use my rate card (on, ×3.00)",
    );
    expect(EXCLUSIVE_COPY.useRateCard(false, 30000)).toBe(
      "Use my rate card (off)",
    );
  });

  it("names the card's premium in the field's helper", () => {
    expect(EXCLUSIVE_COPY.videoFieldHelper(25000)).toBe(
      "Leave empty to use your rate card's ×2.50.",
    );
  });

  it("prints the line with the amounts it is given", () => {
    expect(EXCLUSIVE_COPY.line("CA$4,725.00", "CA$5,197.50")).toBe(
      "Exclusive: License CA$4,725.00 · Buyer pays CA$5,197.50",
    );
  });

  it("is owner answer Q-165's sentence on the Reset sheet", () => {
    expect(EXCLUSIVE_COPY.resetSheet("CA$150")).toBe(
      "Your base price goes back to CA$150, every option to its default, switched on, and exclusive licenses off at ×3.00. New requests only.",
    );
  });
});
