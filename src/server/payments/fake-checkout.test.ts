import { describe, expect, it } from "vitest";
import { isFakeCheckoutEnabled } from "./fake-checkout";

describe("isFakeCheckoutEnabled (07 D51)", () => {
  it.each([
    ["development", "fake", true],
    ["test", "fake", true],
    ["preview", "fake", false],
    ["production", "fake", false],
    ["development", "stripe", false],
    ["test", "stripe", false],
    ["preview", "stripe", false],
    ["production", "stripe", false],
  ] as const)(
    "APP_ENV=%s PAYMENTS_DRIVER=%s → %s",
    (APP_ENV, PAYMENTS_DRIVER, enabled) => {
      expect(isFakeCheckoutEnabled({ APP_ENV, PAYMENTS_DRIVER })).toBe(enabled);
    },
  );
});
