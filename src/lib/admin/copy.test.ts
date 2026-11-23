import { describe, expect, it } from "vitest";
import {
  ADMIN_COLUMNS,
  ADMIN_COPY,
  DISABLE_COPY,
  ENABLE_COPY,
  MONEY_COPY,
  RETRY_COPY,
  REVOKE_COPY,
} from "./copy";

const RELEASE =
  "Its verified posts are released, so the rightful owner can make them licensable.";

describe("DISABLE_COPY (05 §7 callout 6; owner answers Q-198 a, Q-199 a, Q-201–Q-203)", () => {
  it("words the body by the waiting requests it declines", () => {
    expect(DISABLE_COPY.body(0)).toBe(
      `The license page goes dark. Licenses already sold don't change. ${RELEASE}`,
    );
    expect(DISABLE_COPY.body(1)).toBe(
      `The license page goes dark and 1 waiting request is declined. The buyer isn't charged. Licenses already sold don't change. ${RELEASE}`,
    );
    expect(DISABLE_COPY.body(2)).toBe(
      `The license page goes dark and 2 waiting requests are declined. The buyers aren't charged. Licenses already sold don't change. ${RELEASE}`,
    );
  });

  it("warns about the requests the sweep left open", () => {
    expect(DISABLE_COPY.stillOpen(1)).toBe("1 waiting request is still open.");
    expect(DISABLE_COPY.stillOpen(3)).toBe(
      "3 waiting requests are still open.",
    );
  });

  it("words the still-open body for one request and for several (owner answers Q-201, Q-203)", () => {
    expect(DISABLE_COPY.stillOpenBody(1)).toBe(
      "The video is disabled and its posts are released. Try again to decline the request. If you close this, the request can't be charged and its hold is released at its deadline.",
    );
    for (const n of [2, 5]) {
      expect(DISABLE_COPY.stillOpenBody(n)).toBe(
        "The video is disabled and its posts are released. Try again to decline them. If you close this, they can't be charged and their holds are released at their deadlines.",
      );
    }
  });

  it("words the payments already going through apart (owner answer Q-202)", () => {
    expect(DISABLE_COPY.capturing(1)).toBe(
      "1 payment was already going through when the video was disabled, so its license may still be issued.",
    );
    expect(DISABLE_COPY.capturing(2)).toBe(
      "2 payments were already going through when the video was disabled, so their licenses may still be issued.",
    );
  });

  it("names the sheet and the row action by the video's title", () => {
    expect(DISABLE_COPY.title("First snow")).toBe("Disable First snow?");
    expect(DISABLE_COPY.actionLabel("First snow")).toBe("Disable First snow");
  });
});

describe("ENABLE_COPY (design §6.9)", () => {
  it("names the sheet by the video's title", () => {
    expect(ENABLE_COPY.title("Rooftop storm timelapse")).toBe(
      "Enable Rooftop storm timelapse?",
    );
    expect(ENABLE_COPY.actionLabel("Rooftop")).toBe("Enable Rooftop");
  });
});

describe("ADMIN_COPY (05 §7; design §6.4)", () => {
  it("words the Videos cells", () => {
    expect(ADMIN_COPY.postings(3, 2)).toBe("3 · 2 verified");
    expect(ADMIN_COPY.verifiedOn("Demo")).toBe("Verified · Demo");
    expect(ADMIN_COPY.note("ticket-4821")).toBe("Note: ticket-4821");
  });
});

describe("the Licenses tab's money words (05 §7 callouts 7–9; owner answer Q-209)", () => {
  it("names the column Money and the row action's column Action", () => {
    expect(ADMIN_COLUMNS.licenses.money).toBe("Money");
    expect(ADMIN_COLUMNS.licenses.action).toBe("Action");
  });

  it("words the refund and take-back parts, joined with a middle dot", () => {
    expect(
      [
        MONEY_COPY.refunded("CA$1,732.50"),
        MONEY_COPY.takenBack("CA$1,575.00"),
      ].join(MONEY_COPY.separator),
    ).toBe("Refunded CA$1,732.50 · Taken back CA$1,575.00");
    expect([
      MONEY_COPY.refundPending,
      MONEY_COPY.refundFailed,
      MONEY_COPY.noRefund,
      MONEY_COPY.takeBackPending,
      MONEY_COPY.takeBackFailed,
      MONEY_COPY.payoutCanceled,
      MONEY_COPY.nothingToTakeBack,
    ]).toEqual([
      "Refund pending",
      "Refund failed",
      "No refund (money already returned)",
      "Take-back pending",
      "Take-back failed",
      "Payout canceled",
      "Nothing to take back",
    ]);
  });

  it("heads the Events list of failed movements and its columns", () => {
    expect(ADMIN_COPY.failedMovementsHeading).toBe("Failed money movements");
    expect(Object.values(ADMIN_COLUMNS.failedMovements)).toEqual([
      "Kind",
      "License",
      "Amount",
      "Attempt",
      "Error",
      "Updated",
      "Retry",
    ]);
  });
});

describe("REVOKE_COPY (05 §7 callout 10; 04 §11.10; owner answers Q-207, Q-209)", () => {
  it("names the sheet and the row action by the code", () => {
    expect(REVOKE_COPY.title("CL-7K3M-9QXA")).toBe("Revoke CL-7K3M-9QXA?");
    expect(REVOKE_COPY.actionLabel("CL-7K3M-9QXA")).toBe("Revoke CL-7K3M-9QXA");
    expect(REVOKE_COPY.action).toBe("Revoke");
  });

  it("words the body by what the revoke does with the money", () => {
    expect(REVOKE_COPY.takeBackBody("CA$1,732.50", "CA$1,575.00", "maya")).toBe(
      "This refunds the buyer CA$1,732.50 and takes back CA$1,575.00 from @maya.",
    );
    expect(
      REVOKE_COPY.cancelPayoutBody("CA$1,732.50", "CA$1,575.00", "maya"),
    ).toBe(
      "This refunds the buyer CA$1,732.50 and cancels the CA$1,575.00 payout to @maya.",
    );
    expect(REVOKE_COPY.refundOnlyBody("CA$1,732.50")).toBe(
      "This refunds the buyer CA$1,732.50.",
    );
    expect(REVOKE_COPY.paymentReversedBody).toBe(
      "No refund: the money already went back.",
    );
  });

  it("has the buttons, the pending word, the toast and the in-flight refusal", () => {
    expect([
      REVOKE_COPY.cancel,
      REVOKE_COPY.confirm,
      REVOKE_COPY.confirmNoRefund,
      REVOKE_COPY.pending,
      REVOKE_COPY.toast,
    ]).toEqual([
      "Keep license",
      "Revoke and refund",
      "Revoke",
      "Revoking…",
      "License revoked.",
    ]);
    expect(REVOKE_COPY.inProgress("maya")).toBe(
      "A payout to @maya is in progress. Try again in a minute.",
    );
  });
});

describe("RETRY_COPY (05 §7 callout 9; owner answers Q-208, Q-211)", () => {
  it("names each Retry by the movement's kind and the license, and asks by the kind", () => {
    const { kind } = RETRY_COPY;
    expect(
      [kind.buyer_refund, kind.transfer_reversal, kind.creator_transfer].map(
        (k) => [
          k.actionLabel("CL-7K3M-9QXA"),
          k.title,
          k.body("CA$1.00", "maya"),
        ],
      ),
    ).toEqual([
      [
        "Retry refund for CL-7K3M-9QXA",
        "Retry this refund?",
        "This tries again to refund the buyer CA$1.00.",
      ],
      [
        "Retry take-back for CL-7K3M-9QXA",
        "Retry this take-back?",
        "This tries again to take back CA$1.00 from @maya.",
      ],
      [
        "Retry transfer for CL-7K3M-9QXA",
        "Retry this transfer?",
        "This tries again to send CA$1.00 to @maya.",
      ],
    ]);
  });

  it("has the buttons, the pending word, the toasts and the in-sheet lines", () => {
    expect([
      RETRY_COPY.action,
      RETRY_COPY.confirm,
      RETRY_COPY.cancel,
      RETRY_COPY.pending,
      RETRY_COPY.toast,
      RETRY_COPY.nothingToRetry,
      RETRY_COPY.inProgress,
      RETRY_COPY.transient,
    ]).toEqual([
      "Retry",
      "Retry",
      "Cancel",
      "Retrying…",
      "Retry done.",
      "Nothing to retry.",
      "It's already being retried. Try again in a minute.",
      "Stripe didn't answer. Try again in a minute.",
    ]);
    expect(RETRY_COPY.failed("insufficient_funds")).toBe(
      "That didn't work (insufficient_funds). Try again later.",
    );
  });
});
