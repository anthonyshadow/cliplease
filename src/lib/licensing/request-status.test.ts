import { describe, expect, it } from "vitest";
import { LICENSE_REQUEST_STATUSES } from "@/lib/domain/values";
import {
  declinedView,
  REQUEST_STATUS_COPY,
  type RequestView,
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
      requestView(
        {
          status: "checkout_pending",
          statusReason: null,
          autoApproving: false,
        },
        q,
      ),
    ).toBe(view);
  });

  it.each(QUERIES)("an awaiting request is waiting with %o", (q) => {
    expect(
      requestView(
        {
          status: "awaiting_approval",
          statusReason: null,
          autoApproving: false,
        },
        q,
      ),
    ).toBe("waiting");
  });

  it.each(QUERIES)(
    "an awaiting request whose automatic approval may still run is auto_approving with %o (07 D81)",
    (q) => {
      expect(
        requestView(
          {
            status: "awaiting_approval",
            statusReason: null,
            autoApproving: true,
          },
          q,
        ),
      ).toBe("auto_approving");
    },
  );

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
        expect(
          requestView(
            { status: "abandoned", statusReason, autoApproving: false },
            q,
          ),
        ).toBe(view);
      }
    },
  );

  it.each([
    ["approved", null, "approved"],
    ["declined", null, "declined"],
    ["declined", "creator", "declined"],
    ["declined", "video_disabled", "video_disabled"],
    ["expired", null, "expired"],
    ["capture_failed", "capture_error:card_declined", "capture_failed"],
  ] as const)(
    "a %s request (%s) is %s, whatever the query",
    (status, statusReason, view) => {
      for (const q of QUERIES) {
        expect(
          requestView({ status, statusReason, autoApproving: false }, q),
        ).toBe(view);
      }
    },
  );

  it.each(["renewal_pending", "renewal_canceled", "renewal_failed"] as const)(
    "%s has no view: renewals live on My licenses (01 §4.8)",
    (status) => {
      for (const q of QUERIES) {
        expect(
          requestView({ status, statusReason: null, autoApproving: false }, q),
        ).toBeNull();
      }
    },
  );

  it("gives every status a view but the renewal ones", () => {
    const viewless = LICENSE_REQUEST_STATUSES.filter(
      (status) =>
        requestView(
          { status, statusReason: null, autoApproving: false },
          QUERIES[0],
        ) === null,
    );
    expect(viewless).toEqual([
      "renewal_pending",
      "renewal_canceled",
      "renewal_failed",
    ]);
  });
});

describe("declinedView (01 §4.8, 07 D28): /r's and request-declined's reason rule", () => {
  it.each([
    ["creator", "declined"],
    ["video_disabled", "video_disabled"],
    [null, "declined"],
    ["something_new", "declined"],
  ] as const)("a decline for %s is %s, on /r too", (statusReason, view) => {
    expect(declinedView(statusReason)).toBe(view);
    expect(
      requestView(
        { status: "declined", statusReason, autoApproving: false },
        QUERIES[0],
      ),
    ).toBe(view);
  });
});

describe("the views' words, verbatim from 01 §4.8 (07 D27, D28)", () => {
  const facts = { handle: "maya", total: "CA$1,732.50", deadline: null };
  const words = (view: RequestView, deadline: string | null = null) => ({
    title: viewTitle(view, "maya"),
    body: VIEW_COPY[view].body({ ...facts, deadline }),
    backLink: VIEW_COPY[view].backLink,
  });

  it.each([
    [
      "finishing",
      "Finishing checkout…",
      "If you closed the payment page, you can start again from the license link. Nothing has been charged.",
      false,
    ],
    [
      "returning",
      "Finishing checkout…",
      "If you closed the payment page, you can start again from the license link. Nothing has been charged.",
      false,
    ],
    [
      "canceled",
      "Checkout not completed",
      "Checkout not completed. Nothing was charged.",
      true,
    ],
    [
      "payment_failed",
      "Payment didn't go through",
      "Payment didn't go through. Nothing was charged.",
      true,
    ],
    [
      "unavailable",
      "Checkout not completed",
      "This video isn't available for licensing right now. Nothing was charged.",
      true,
    ],
    [
      "approved",
      "Approved",
      "@maya approved. You were charged CA$1,732.50. Your file and license are ready.",
      false,
    ],
    [
      "declined",
      "Not approved",
      "@maya didn't approve this request. You haven't been charged, and the hold on your card has been released.",
      false,
    ],
    [
      "video_disabled",
      "Not approved",
      "This video is no longer available. You haven't been charged, and the hold on your card has been released.",
      false,
    ],
    [
      "capture_failed",
      "Payment didn't go through",
      "@maya approved, but your card couldn't be charged, so no license was issued. You haven't been charged. You can try again from the license link.",
      true,
    ],
  ] as const)("%s: %s", (view, title, body, backLink) => {
    expect(words(view)).toEqual({ title, body, backLink });
  });

  it("waiting names the creator and, once known, the deadline", () => {
    expect(words("waiting", "Fri 30 Oct, 3:10 PM EDT")).toEqual({
      title: "Waiting for @maya",
      body: "Your card has a hold of CA$1,732.50, not a charge. @maya has until Fri 30 Oct, 3:10 PM EDT to approve. We'll email you either way.",
      backLink: false,
    });
    expect(words("waiting").body).toBe(
      "Your card has a hold of CA$1,732.50, not a charge. We'll email you either way.",
    );
  });

  it("auto_approving reads Processing… with 05 §4.3 callout 9's body and no deadline (07 D81)", () => {
    const deadline = "Fri 30 Oct, 3:10 PM EDT";
    expect(words("auto_approving", deadline)).toEqual({
      title: "Processing…",
      body: "@maya approves requests automatically. Your card has a hold of CA$1,732.50 until it's approved. This page updates by itself.",
      backLink: false,
    });
    expect(words("auto_approving").body).toBe(
      words("auto_approving", deadline).body,
    );
    expect(COPY.autoApproves("maya")).toBe(
      "@maya approves requests automatically.",
    );
  });

  it("expired names the deadline once known", () => {
    expect(words("expired", "Fri 30 Oct, 3:10 PM EDT")).toEqual({
      title: "No answer in time",
      body: "@maya didn't answer by Fri 30 Oct, 3:10 PM EDT. You haven't been charged, and the hold on your card has been released.",
      backLink: false,
    });
    expect(words("expired").body).toBe(
      "You haven't been charged, and the hold on your card has been released.",
    );
  });

  it("has the small words 04 and 05 give", () => {
    expect(COPY.updatesItself).toBe("This page updates by itself.");
    expect(COPY.processing).toBe("Processing…");
    expect([COPY.scope, COPY.total]).toEqual(["Scope", "Total"]);
    expect(COPY.backToLicense).toBe("Back to the license page");
  });
});
