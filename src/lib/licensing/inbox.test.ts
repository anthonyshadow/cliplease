import { describe, expect, it } from "vitest";
import {
  approveOutcome,
  INBOX_COPY,
  outcomeLine,
  requestPageLine,
  requestPill,
} from "./inbox";

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

describe("approveOutcome (04 §11.5; 05 §6.3 States)", () => {
  const request = { licensePriceCents: 157500, currency: "cad" } as const;

  it("settles an approval with the seal, the code line and the CA$ toast (07 D99)", () => {
    expect(
      approveOutcome({ ok: true, licenseCode: "CL-7K3M-9QXA" }, request),
    ).toEqual({
      settles: true,
      pill: "approved",
      line: { kind: "issued", code: "CL-7K3M-9QXA" },
      toast: "Approved. CA$1,575.00 is on its way to your Stripe balance.",
    });
    expect(INBOX_COPY.licenseIssued("CL-7K3M-9QXA")).toBe(
      "License CL-7K3M-9QXA issued",
    );
  });

  it("settles a late tap with the countdown kept and no 'wasn't charged' yet (07 D25; owner answer P18 Q2)", () => {
    const o = approveOutcome(
      { ok: false, reason: "expired", status: "awaiting_approval" },
      request,
    );
    expect(o).toMatchObject({ settles: true, pill: null, toast: null });
    expect(o.line).toEqual({
      kind: "text",
      text: "This request expired.",
      danger: false,
    });
  });

  it("settles a failed capture with its pill and the danger line, no toast", () => {
    expect(
      approveOutcome(
        { ok: false, reason: "capture_failed", status: "capture_failed" },
        request,
      ),
    ).toMatchObject({
      settles: true,
      pill: "capture_failed",
      line: {
        kind: "text",
        text: INBOX_COPY.captureFailedLine,
        danger: true,
        recorded: true,
      },
      toast: null,
    });
  });

  it.each([
    [
      "retry",
      {
        kind: "text",
        text: "Couldn't reach the payment service. Try again.",
        danger: false,
      },
    ],
    ["payouts_not_active", { kind: "payouts" }],
    ["original_missing", { kind: "original_missing" }],
  ] as const)("leaves the row live on %s, with its line", (reason, line) => {
    expect(
      approveOutcome(
        { ok: false, reason, status: "awaiting_approval" },
        request,
      ),
    ).toEqual({ settles: false, pill: null, line, toast: null });
  });

  it.each(["approved", "declined", "expired", "capture_failed"] as const)(
    "settles a race lost to %s quietly with that pill (J8.8)",
    (status) => {
      expect(
        approveOutcome(
          { ok: false, reason: "not_actionable", status },
          request,
        ),
      ).toEqual({
        settles: true,
        pill: status,
        line: null,
        toast: null,
      });
    },
  );

  it("settles nothing while another claim runs: the refresh shows Processing…", () => {
    expect(
      approveOutcome(
        { ok: false, reason: "not_actionable", status: "awaiting_approval" },
        request,
      ),
    ).toEqual({
      settles: false,
      pill: null,
      line: null,
      toast: null,
    });
  });

  it("says the generic error for the action's own failure or a request that isn't the creator's", () => {
    const generic = {
      settles: false,
      pill: null,
      line: {
        kind: "text",
        text: "Something went wrong. Try again.",
        danger: false,
      },
      toast: null,
    };
    expect(approveOutcome(null, request)).toEqual(generic);
    expect(
      approveOutcome(
        { ok: false, reason: "not_actionable", status: null },
        request,
      ),
    ).toEqual(generic);
  });

  it("words the missing original with the owner's answer (P18 Q1)", () => {
    expect(INBOX_COPY.originalMissing).toBe(
      "The original file for this video is missing, so this request can't be approved yet. Questions?",
    );
  });
});

describe("requestPageLine (05 §6.4)", () => {
  const waiting = {
    licenseCode: null,
    status: "awaiting_approval",
    statusReason: null,
  } as const;
  const request = { licensePriceCents: 157500, currency: "cad" } as const;
  const late = approveOutcome(
    { ok: false, reason: "expired", status: "awaiting_approval" },
    request,
  );

  it("leaves a line the record shows to the record: the license's code, a failed capture", () => {
    for (const result of [
      { ok: true, licenseCode: "CL-7K3M-9QXA" },
      { ok: false, reason: "capture_failed", status: "capture_failed" },
    ] as const) {
      expect(
        requestPageLine(approveOutcome(result, request), waiting, false),
      ).toBeNull();
    }
  });

  it("keeps a late tap's line while the request waits, and drops it once its expiry is stored", () => {
    expect(requestPageLine(late, waiting, false)).toEqual(late.line);
    expect(
      requestPageLine(
        late,
        { licenseCode: null, status: "expired", statusReason: "deadline" },
        false,
      ),
    ).toBeNull();
  });

  it("keeps a line the record never shows after the refresh (a plain decline's, P19)", () => {
    const declined = {
      settles: true,
      pill: "declined",
      line: {
        kind: "text",
        text: "Declined. The buyer wasn't charged.",
        danger: false,
      },
      toast: null,
    } as const;
    expect(
      requestPageLine(
        declined,
        { licenseCode: null, status: "declined", statusReason: "creator" },
        false,
      ),
    ).toEqual(declined.line);
  });

  it("leaves the payouts sentence to the page's Notice when it shows", () => {
    const payouts = approveOutcome(
      { ok: false, reason: "payouts_not_active", status: "awaiting_approval" },
      request,
    );
    expect(requestPageLine(payouts, waiting, true)).toBeNull();
    expect(requestPageLine(payouts, waiting, false)).toEqual({
      kind: "payouts",
    });
  });
});
