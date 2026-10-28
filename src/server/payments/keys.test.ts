import { describe, expect, it } from "vitest";
import {
  cancelKey,
  captureKey,
  checkoutSessionKey,
  stripeCancelReason,
  transferGroupFor,
} from "./keys";

const ID = "6f4c8d7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

describe("payment keys (07 §2.4, D74)", () => {
  it("names the session, each capture and cancel claim, and the transfer group", () => {
    expect(checkoutSessionKey(ID)).toBe(`checkout-session:${ID}`);
    expect(captureKey(ID, 1)).toBe(`pi-capture:${ID}:1`);
    expect(cancelKey(ID, "decline", 2)).toBe(`pi-cancel:${ID}:decline:2`);
    expect(cancelKey(ID, "expire", 0)).toBe(`pi-cancel:${ID}:expire:0`);
    expect(transferGroupFor(ID)).toBe(`license-request:${ID}`);
  });

  it("tells Stripe a decline was the customer's choice, and every other cancel abandoned", () => {
    expect(stripeCancelReason("decline")).toBe("requested_by_customer");
    for (const reason of [
      "expire",
      "capture_failed",
      "amount_mismatch",
      "hold_too_short",
      "video_unavailable",
    ] as const) {
      expect(stripeCancelReason(reason)).toBe("abandoned");
    }
  });
});
