import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./email";

describe("normalizeEmail (07 D126)", () => {
  it("trims and lowercases, keeping dots and +tags", () => {
    expect(normalizeEmail("  Ana.Buyer@Studio.COM ")).toBe(
      "ana.buyer@studio.com",
    );
    expect(normalizeEmail("Ana.Buyer+ads@Studio.COM")).toBe(
      "ana.buyer+ads@studio.com",
    );
  });

  it("leaves a normalized address as it is", () => {
    const once = normalizeEmail(" Sam@DailyLaughs.com");
    expect(normalizeEmail(once)).toBe(once);
  });
});
