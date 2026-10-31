import { describe, expect, it } from "vitest";
import {
  LICENSE_REQUEST_STATUSES,
  type LicenseRequestStatus,
} from "@/lib/domain/values";
import { HOUR_MS } from "@/lib/time";
import {
  displayStatus,
  effectiveStatus,
  isAutoApproving,
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

/** A manual request's auto-approve inputs. */
const MANUAL = { autoApprove: false, autoApproveFallbackAt: null } as const;
/** An auto_approve request that fell back to the creator. */
const FELL_BACK = new Date("2026-10-27T12:05:00Z");
/** Every auto-approve combination: manual, auto still running, auto fallen back. */
const AUTO_INPUTS = [
  MANUAL,
  { autoApprove: true, autoApproveFallbackAt: null },
  { autoApprove: true, autoApproveFallbackAt: FELL_BACK },
] as const;

describe("displayStatus (07 D25, D26, D81; owner answer Q-142 a)", () => {
  it.each([
    { paymentAction: "capture", overdue: false, shown: "processing" },
    { paymentAction: "capture", overdue: true, shown: "processing" },
    { paymentAction: "decline", overdue: false, shown: "processing" },
    { paymentAction: "decline", overdue: true, shown: "processing" },
    { paymentAction: "expire", overdue: false, shown: "processing" },
    { paymentAction: "expire", overdue: true, shown: "processing" },
    { paymentAction: null, overdue: false, shown: "awaiting_approval" },
    { paymentAction: null, overdue: true, shown: "expired" },
  ] as const)(
    "reads a waiting manual request with claim $paymentAction, overdue $overdue, as $shown: a claim is processing even past its deadline, and an unclaimed one past it expired until the expiry is stored",
    ({ paymentAction, overdue, shown }) => {
      expect(
        displayStatus({
          status: "awaiting_approval",
          paymentAction,
          overdue,
          ...MANUAL,
        }),
      ).toBe(shown);
    },
  );

  it.each([
    {
      name: "running, unclaimed, before its deadline",
      paymentAction: null,
      overdue: false,
      autoApproveFallbackAt: null,
      shown: "processing",
    },
    {
      name: "running, past its deadline",
      paymentAction: null,
      overdue: true,
      autoApproveFallbackAt: null,
      shown: "expired",
    },
    {
      name: "running, claimed by the system's capture",
      paymentAction: "capture",
      overdue: false,
      autoApproveFallbackAt: null,
      shown: "processing",
    },
    {
      name: "fallen back, unclaimed",
      paymentAction: null,
      overdue: false,
      autoApproveFallbackAt: FELL_BACK,
      shown: "awaiting_approval",
    },
    {
      name: "fallen back, past its deadline",
      paymentAction: null,
      overdue: true,
      autoApproveFallbackAt: FELL_BACK,
      shown: "expired",
    },
    {
      name: "fallen back, claimed by the creator's capture",
      paymentAction: "capture",
      overdue: false,
      autoApproveFallbackAt: FELL_BACK,
      shown: "processing",
    },
  ] as const)(
    "reads a waiting auto_approve request $name as $shown",
    ({ paymentAction, overdue, autoApproveFallbackAt, shown }) => {
      expect(
        displayStatus({
          status: "awaiting_approval",
          paymentAction,
          overdue,
          autoApprove: true,
          autoApproveFallbackAt,
        }),
      ).toBe(shown);
    },
  );

  it.each(LICENSE_REQUEST_STATUSES.filter((s) => s !== "awaiting_approval"))(
    "shows %s as stored, a claim left on the row or not, overdue or not, auto_approve or not",
    (status) => {
      for (const overdue of [false, true]) {
        for (const auto of AUTO_INPUTS) {
          expect(
            displayStatus({
              status,
              paymentAction: "capture",
              overdue,
              ...auto,
            }),
          ).toBe(status);
          expect(
            displayStatus({ status, paymentAction: null, overdue, ...auto }),
          ).toBe(status);
        }
      }
    },
  );
});

describe("isAutoApproving (07 D81)", () => {
  const running = {
    status: "awaiting_approval",
    autoApprove: true,
    autoApproveFallbackAt: null,
    overdue: false,
  } as const;

  it("is true for a waiting auto_approve request with no fallback before its deadline", () => {
    expect(isAutoApproving(running)).toBe(true);
  });

  it.each([
    { name: "a manual request", change: { autoApprove: false } },
    {
      name: "one that fell back",
      change: { autoApproveFallbackAt: FELL_BACK },
    },
    { name: "one past its deadline", change: { overdue: true } },
  ] as const)("is false for $name", ({ change }) => {
    expect(isAutoApproving({ ...running, ...change })).toBe(false);
  });

  it.each(LICENSE_REQUEST_STATUSES.filter((s) => s !== "awaiting_approval"))(
    "is false once %s",
    (status) => {
      expect(isAutoApproving({ ...running, status })).toBe(false);
    },
  );
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
