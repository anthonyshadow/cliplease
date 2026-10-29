import { describe, expect, it } from "vitest";
import {
  LICENSE_REQUEST_STATUSES,
  type LicenseRequestStatus,
} from "@/lib/domain/values";
import { HOUR_MS } from "@/lib/time";
import {
  displayStatus,
  effectiveStatus,
  isTerminal,
  LICENSE_REQUEST_EVENTS,
  type LicenseRequestEvent,
  nextStatus,
  TRANSITIONS,
} from "./transitions";

type Row = Record<LicenseRequestEvent, LicenseRequestStatus | null>;

/** A status's row with every event ignored, then `to`'s entries. */
const row = (to: Partial<Row> = {}): Row => ({
  ...(Object.fromEntries(LICENSE_REQUEST_EVENTS.map((e) => [e, null])) as Row),
  ...to,
});

/** 07 §2.2, written out pair by pair. */
const EXPECTED: Record<LicenseRequestStatus, Row> = {
  checkout_pending: row({
    authorized: "awaiting_approval",
    checkout_expired: "abandoned",
    checkout_failed: "abandoned",
    amount_mismatch: "abandoned",
    hold_too_short: "abandoned",
    video_unavailable: "abandoned",
  }),
  awaiting_approval: row({
    captured: "approved",
    capture_failed: "capture_failed",
    declined: "declined",
    expired: "expired",
  }),
  approved: row(),
  declined: row(),
  expired: row(),
  abandoned: row(),
  capture_failed: row(),
  renewal_pending: row(),
  renewal_canceled: row(),
  renewal_failed: row(),
};

const PAIRS = LICENSE_REQUEST_STATUSES.flatMap((from) =>
  LICENSE_REQUEST_EVENTS.map((event) => ({
    from,
    event,
    to: EXPECTED[from][event],
  })),
);

describe("TRANSITIONS (07 §2.2)", () => {
  it("has an entry for every status and nothing else", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual(
      [...LICENSE_REQUEST_STATUSES].sort(),
    );
  });

  it.each(PAIRS)("$from + $event → $to", ({ from, event, to }) => {
    expect(nextStatus(from, event)).toBe(to);
  });

  it("has no self-loop: an event never leaves a request where it was", () => {
    for (const { from, to } of PAIRS) expect(to).not.toBe(from);
  });
});

describe("isTerminal (03 §5.1, 07 D117)", () => {
  const terminal: readonly LicenseRequestStatus[] = [
    "approved",
    "declined",
    "expired",
    "abandoned",
    "capture_failed",
    "renewal_canceled",
    "renewal_failed",
  ];

  it.each(LICENSE_REQUEST_STATUSES)("%s", (status) => {
    expect(isTerminal(status)).toBe(terminal.includes(status));
  });

  it("keeps renewal_pending open although P22b fills its transitions", () => {
    expect(isTerminal("renewal_pending")).toBe(false);
    expect(Object.keys(TRANSITIONS.renewal_pending)).toEqual([]);
  });
});

describe("displayStatus (07 D25, D26)", () => {
  it("reads a claimed waiting request as processing", () => {
    expect(
      displayStatus({ status: "awaiting_approval", paymentAction: "capture" }),
    ).toBe("processing");
    expect(
      displayStatus({ status: "awaiting_approval", paymentAction: "decline" }),
    ).toBe("processing");
  });

  it.each(LICENSE_REQUEST_STATUSES.filter((s) => s !== "awaiting_approval"))(
    "shows %s as stored, a claim left on the row or not",
    (status) => {
      expect(displayStatus({ status, paymentAction: "capture" })).toBe(status);
      expect(displayStatus({ status, paymentAction: null })).toBe(status);
    },
  );

  it("keeps an unclaimed waiting request waiting: it reads no clock", () => {
    expect(
      displayStatus({ status: "awaiting_approval", paymentAction: null }),
    ).toBe("awaiting_approval");
  });
});

describe("effectiveStatus (07 D26)", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const at = (offsetH: number) => new Date(now.getTime() + offsetH * HOUR_MS);
  const waiting = {
    status: "awaiting_approval" as const,
    expiresAt: at(5),
    paymentAction: null,
  };

  it("is the stored status before the deadline", () => {
    expect(effectiveStatus(waiting, now)).toBe("awaiting_approval");
  });

  it("is expired at and past the deadline, with no claim", () => {
    expect(effectiveStatus({ ...waiting, expiresAt: now }, now)).toBe(
      "expired",
    );
    expect(effectiveStatus({ ...waiting, expiresAt: at(-1) }, now)).toBe(
      "expired",
    );
  });

  it("is processing while a claim is in flight, even past the deadline", () => {
    expect(effectiveStatus({ ...waiting, paymentAction: "capture" }, now)).toBe(
      "processing",
    );
    expect(
      effectiveStatus(
        { ...waiting, expiresAt: at(-1), paymentAction: "decline" },
        now,
      ),
    ).toBe("processing");
  });

  it("keeps a finished row's status although its claim stays set (P18)", () => {
    expect(
      effectiveStatus(
        { status: "approved", expiresAt: at(-1), paymentAction: "capture" },
        now,
      ),
    ).toBe("approved");
  });

  it.each(LICENSE_REQUEST_STATUSES.filter((s) => s !== "awaiting_approval"))(
    "%s past a deadline stays %s",
    (status) => {
      expect(
        effectiveStatus(
          { status, expiresAt: at(-1), paymentAction: null },
          now,
        ),
      ).toBe(status);
    },
  );

  it("is the stored status without a deadline", () => {
    expect(effectiveStatus({ ...waiting, expiresAt: null }, now)).toBe(
      "awaiting_approval",
    );
  });
});
