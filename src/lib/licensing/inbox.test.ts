import { describe, expect, it } from "vitest";
import { INBOX_COPY, outcomeLine, requestPill } from "./inbox";

describe("the Inbox's words (04 §11.5; 05 §6.3, §6.4)", () => {
  it("counts in the title and the segment", () => {
    expect(`${INBOX_COPY.title} ${INBOX_COPY.waitingForYou(2)}`).toBe(
      "Inbox. 2 waiting for you.",
    );
    expect(`${INBOX_COPY.title} ${INBOX_COPY.caughtUp}`).toBe(
      "Inbox. All caught up.",
    );
    expect(INBOX_COPY.waitingSegment(0)).toBe("Waiting 0");
  });

  it("words the facts with the currency's amounts", () => {
    expect(INBOX_COPY.youGet("CA$1,575.00")).toBe("You get CA$1,575.00");
    expect(INBOX_COPY.youGetFact("CA$1,575.00", "CA$1,732.50")).toBe(
      "CA$1,575.00 (buyer pays CA$1,732.50 incl. service fee)",
    );
    expect(INBOX_COPY.paymentFact).toBe(
      "Card on hold. Charged only if you approve.",
    );
    expect(INBOX_COPY.answerByFact("Sun 18 Oct, 3:10 PM EDT")).toBe(
      "Sun 18 Oct, 3:10 PM EDT. If you don't answer, the hold is released.",
    );
    expect(INBOX_COPY.answerByFact(null)).toBe(
      "If you don't answer, the hold is released.",
    );
  });

  it("names the soonest deadline in the payouts message once it is known (01 J8.3)", () => {
    expect(INBOX_COPY.payoutsWaiting("Sun 18 Oct, 3:10 PM EDT")).toBe(
      "Finish payout setup to approve. This request stays open until Sun 18 Oct, 3:10 PM EDT.",
    );
    expect(INBOX_COPY.payoutsWaiting(null)).toBe(
      "Finish payout setup to approve.",
    );
  });

  it("heads the request page with the licensee and the title (owner answer Q-126 a)", () => {
    expect(
      INBOX_COPY.detailHeading("Daily Laughs Media LLC", "First snow"),
    ).toBe("Daily Laughs Media LLC wants to license First snow");
    expect([INBOX_COPY.openRequest, INBOX_COPY.historyEmpty]).toEqual([
      "Open request",
      "No decided requests yet.",
    ]);
  });
});

describe("requestPill (04 §9.9; 07 D26)", () => {
  it.each([
    ["processing", "Processing…", "neutral"],
    ["approved", "Approved", "cleared"],
    ["declined", "Declined", "neutral"],
    ["expired", "Expired", "neutral"],
    ["capture_failed", "Payment failed", "danger"],
  ] as const)("%s reads %s (%s)", (status, label, tone) => {
    expect(requestPill(status)).toEqual({ label, tone });
  });

  it("leaves a waiting request to its countdown", () => {
    expect(requestPill("awaiting_approval")).toBeNull();
  });
});

describe("outcomeLine (04 §11.5)", () => {
  const deadline = "Mon 12 Oct, 3:10 PM EDT";

  it("names an expiry's deadline once known", () => {
    expect(
      outcomeLine({ status: "expired", statusReason: null }, deadline),
    ).toEqual({
      text: "Expired. No answer by Mon 12 Oct, 3:10 PM EDT. The buyer wasn't charged.",
      danger: false,
    });
    expect(
      outcomeLine({ status: "expired", statusReason: null }, null)?.text,
    ).toBe("Expired. The buyer wasn't charged.");
  });

  it("puts a failed capture in danger text", () => {
    expect(
      outcomeLine(
        { status: "capture_failed", statusReason: "capture_error:x" },
        null,
      ),
    ).toEqual({
      text: "Payment didn't go through. No license was issued and the buyer wasn't charged.",
      danger: true,
    });
  });

  it("explains a request declined because the video was disabled (07 D28)", () => {
    expect(
      outcomeLine({ status: "declined", statusReason: "video_disabled" }, null)
        ?.text,
    ).toBe(
      "This video was disabled, so the request was declined. The buyer wasn't charged.",
    );
  });

  it.each([
    ["approved", null],
    ["declined", "creator_declined"],
    ["awaiting_approval", null],
  ] as const)("has no line for %s (%s)", (status, statusReason) => {
    expect(outcomeLine({ status, statusReason }, deadline)).toBeNull();
  });
});
