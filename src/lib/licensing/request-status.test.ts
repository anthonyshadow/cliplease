import { describe, expect, it } from "vitest";
import { LICENSE_REQUEST_STATUSES } from "@/lib/domain/values";
import {
  REQUEST_STATUS_COPY,
  requestView,
  VIEW_COPY,
  viewTitle,
} from "./request-status";

const COPY = REQUEST_STATUS_COPY;
const QUERIES = [
  { canceled: false, returning: false },
  { canceled: true, returning: false },
  { canceled: false, returning: true },
  { canceled: true, returning: true },
];

describe("requestView (05 §4.3, 07 D27)", () => {
  it.each([
    [{ canceled: false, returning: false }, "finishing"],
    [{ canceled: true, returning: false }, "canceled"],
    [{ canceled: false, returning: true }, "returning"],
    [{ canceled: true, returning: true }, "canceled"],
  ] as const)("a pending request with %o is %s", (q, view) => {
    expect(
      requestView({ status: "checkout_pending", statusReason: null }, q),
    ).toBe(view);
  });

  it.each(QUERIES)("an awaiting request is waiting with %o", (q) => {
    expect(
      requestView({ status: "awaiting_approval", statusReason: null }, q),
    ).toBe("waiting");
  });

  it.each([
    ["checkout_expired", "canceled"],
    ["checkout_failed", "canceled"],
    ["amount_mismatch", "payment_failed"],
    ["hold_too_short", "payment_failed"],
    ["video_unavailable", "unavailable"],
    [null, "canceled"],
    ["something_new", "canceled"],
  ] as const)(
    "an abandoned request for %s is %s, whatever the query",
    (statusReason, view) => {
      for (const q of QUERIES) {
        expect(requestView({ status: "abandoned", statusReason }, q)).toBe(
          view,
        );
      }
    },
  );

  it.each(
    LICENSE_REQUEST_STATUSES.filter(
      (s) =>
        !["checkout_pending", "awaiting_approval", "abandoned"].includes(s),
    ),
  )("%s has no view before P17", (status) => {
    for (const q of QUERIES) {
      expect(requestView({ status, statusReason: null }, q)).toBeNull();
    }
  });
});

describe("the views' words (01 §4.8, 07 D27)", () => {
  it("titles each view, the waiting one by the creator", () => {
    expect(viewTitle("waiting", "maya")).toBe("Waiting for @maya");
    expect(viewTitle("canceled", "maya")).toBe("Checkout not completed");
    expect(viewTitle("payment_failed", "maya")).toBe(
      "Payment didn't go through",
    );
    expect(viewTitle("unavailable", "maya")).toBe("Checkout not completed");
    expect(viewTitle("returning", "maya")).toBe("Finishing checkout…");
  });

  it.each(["canceled", "payment_failed", "unavailable"] as const)(
    "%s ends checkout, nothing charged, with the way back",
    (view) => {
      expect(VIEW_COPY[view].backLink).toBe(true);
      expect(VIEW_COPY[view].body).toMatch(/Nothing was charged\.$/);
    },
  );

  it.each(["finishing", "returning"] as const)(
    "%s doesn't end checkout: no way back",
    (view) => {
      expect(VIEW_COPY[view].backLink).toBe(false);
    },
  );

  it("names the deadline once it is known", () => {
    expect(
      COPY.waitingBody("maya", "CA$1,732.50", "Fri 30 Oct, 3:10 PM EDT"),
    ).toBe(
      "Your card has a hold of CA$1,732.50, not a charge. @maya has until Fri 30 Oct, 3:10 PM EDT to approve. We'll email you either way.",
    );
    expect(COPY.waitingBody("maya", "CA$1,732.50", null)).toBe(
      "Your card has a hold of CA$1,732.50, not a charge. We'll email you either way.",
    );
  });
});
