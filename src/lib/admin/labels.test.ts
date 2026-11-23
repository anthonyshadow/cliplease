import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTOR_TYPES,
  LICENSE_REQUEST_STATUSES,
  LICENSE_REVOKED_REASONS,
  MONEY_MOVEMENT_KINDS,
  PAYOUTS_STATUSES,
} from "../domain/values";
import {
  ADMIN_EVENT_FLAGS,
  adminAccountStatus,
  adminPayoutsStatus,
  adminRequestStatus,
  auditActorLabel,
  autoApproveLabel,
  isAdminEventFlag,
  LICENSE_REVOKED_REASON_LABELS,
  MONEY_MOVEMENT_KIND_LABELS,
  transferLabel,
} from "./labels";

describe("isAdminEventFlag (05 §7; design §4.9)", () => {
  it.each(ADMIN_EVENT_FLAGS)("flags %s", (action) => {
    expect(isAdminEventFlag(action)).toBe(true);
  });

  it("has P21's six flags, the three the code also writes, and P21b's refund and take-back failures", () => {
    expect(ADMIN_EVENT_FLAGS).toEqual([
      "license_request.money_moved_late",
      "license_request.cancel_failed",
      "license_request.transfer_failed",
      "license_request.auto_approve_fallback",
      "license_request.exclusive_conflict",
      "video_posting.conflict",
      "license_request.issue_failed",
      "stripe_event.currency_mismatch",
      "connect.negative_balance_debits_failed",
      "license.refund_failed",
      "license.reversal_failed",
    ]);
  });

  it.each([
    "video_posting.released",
    "video.disabled",
    "video.enabled",
    "license_request.transition",
    "license_request.money_moved",
    "license.revoked",
    "license.refund_succeeded",
    "license.reversal_succeeded",
    "money_movement.retried",
    "",
  ])("reads %s as a normal row", (action) => {
    expect(isAdminEventFlag(action)).toBe(false);
  });
});

describe("LICENSE_REVOKED_REASON_LABELS (05 §7 callout 10)", () => {
  it("labels every license_revoked_reason, in the enum's order", () => {
    expect(Object.keys(LICENSE_REVOKED_REASON_LABELS)).toEqual([
      ...LICENSE_REVOKED_REASONS,
    ]);
    expect(LICENSE_REVOKED_REASON_LABELS).toEqual({
      rights_claim: "Rights claim",
      licensee_breach: "Licensee breach",
      payment_reversed: "Payment reversed",
      issued_in_error: "Issued in error",
    });
  });
});

describe("MONEY_MOVEMENT_KIND_LABELS (owner answer Q-209)", () => {
  it("labels every money_movement_kind", () => {
    expect(Object.keys(MONEY_MOVEMENT_KIND_LABELS).sort()).toEqual(
      [...MONEY_MOVEMENT_KINDS].sort(),
    );
    expect(MONEY_MOVEMENT_KIND_LABELS).toEqual({
      creator_transfer: "Transfer",
      buyer_refund: "Refund",
      transfer_reversal: "Take-back",
    });
  });
});

describe("adminRequestStatus (04 §9.9; design §4.8)", () => {
  it.each([
    ["approved", { kind: "pill", label: "Approved", tone: "cleared" }],
    ["declined", { kind: "pill", label: "Declined", tone: "neutral" }],
    ["expired", { kind: "pill", label: "Expired", tone: "neutral" }],
    [
      "capture_failed",
      { kind: "pill", label: "Payment failed", tone: "danger" },
    ],
    ["checkout_pending", { kind: "raw", text: "checkout_pending" }],
    ["awaiting_approval", { kind: "raw", text: "awaiting_approval" }],
    ["abandoned", { kind: "raw", text: "abandoned" }],
    ["renewal_pending", { kind: "raw", text: "renewal_pending" }],
  ] as const)("%s", (status, want) => {
    expect(adminRequestStatus({ status, claimed: false })).toEqual(want);
  });

  it("reads Processing… for a claimed waiting request only (07 D26)", () => {
    expect(
      adminRequestStatus({ status: "awaiting_approval", claimed: true }),
    ).toEqual({ kind: "pill", label: "Processing…", tone: "neutral" });
    // A finished row keeps its claim: its ending shows.
    expect(adminRequestStatus({ status: "declined", claimed: true })).toEqual({
      kind: "pill",
      label: "Declined",
      tone: "neutral",
    });
  });

  it("gives every status a cell", () => {
    for (const status of LICENSE_REQUEST_STATUSES) {
      expect(adminRequestStatus({ status, claimed: false })).toBeTruthy();
    }
  });
});

describe("adminAccountStatus (04 §9.9; 05 §1.5)", () => {
  it.each([
    [
      "connected",
      false,
      { kind: "pill", label: "Connected", tone: "neutral", dot: "solid" },
    ],
    [
      "connected",
      true,
      { kind: "pill", label: "Sync problem", tone: "awaiting" },
    ],
    [
      "needs_reconnect",
      false,
      { kind: "pill", label: "Needs reconnect", tone: "awaiting" },
    ],
    ["disconnected", false, { kind: "raw", text: "disconnected" }],
  ] as const)("%s, sync problem %s", (status, syncProblem, want) => {
    expect(adminAccountStatus({ status, syncProblem })).toEqual(want);
  });
});

describe("adminPayoutsStatus (design §6.2; 01 J11.1)", () => {
  it.each([
    ["not_started", { kind: "pill", label: "Not set up", tone: "neutral" }],
    [
      "pending",
      {
        kind: "pill",
        label: "Stripe is checking your details",
        tone: "awaiting",
      },
    ],
    ["active", { kind: "pill", label: "Payouts on", tone: "cleared" }],
    [
      "restricted",
      {
        kind: "pill",
        label: "Stripe needs more information",
        tone: "awaiting",
      },
    ],
    [
      "rejected",
      { kind: "pill", label: "Payouts unavailable", tone: "danger" },
    ],
    [
      "unsupported",
      { kind: "pill", label: "Payouts unavailable", tone: "danger" },
    ],
  ] as const)("%s", (status, want) => {
    expect(adminPayoutsStatus(status)).toEqual(want);
  });

  it("gives every status a pill", () => {
    for (const status of PAYOUTS_STATUSES) {
      expect(adminPayoutsStatus(status).kind).toBe("pill");
    }
  });
});

describe("autoApproveLabel (07 D81)", () => {
  it.each([
    [false, false, null],
    [true, false, "on"],
    [true, true, "on · fell back"],
  ] as const)("auto %s, fell back %s → %s", (autoApprove, fellBack, want) => {
    expect(
      autoApproveLabel({ autoApprove, autoApproveFellBack: fellBack }),
    ).toBe(want);
  });
});

describe("transferLabel (05 §7 callout 7; owner answer Q-199 a)", () => {
  const transfer = {
    amountCents: 157500,
    currency: "cad",
    lastError: null,
  } as const;

  it.each([
    ["succeeded", "Transfer CA$1,575.00 sent"],
    ["pending", "Transfer pending"],
    ["failed", "Transfer failed"],
    ["canceled", null],
  ] as const)("%s → %s", (status, want) => {
    expect(transferLabel({ ...transfer, status })).toBe(want);
  });

  it("names a failure's code, and the amount in its own currency", () => {
    expect(
      transferLabel({
        ...transfer,
        status: "failed",
        lastError: "account_closed",
      }),
    ).toBe("Transfer failed (account_closed)");
    expect(
      transferLabel({
        ...transfer,
        status: "succeeded",
        amountCents: 26250,
        currency: "usd",
      }),
    ).toBe("Transfer US$262.50 sent");
  });

  it("has no label without a transfer", () => {
    expect(transferLabel(null)).toBeNull();
  });
});

describe("auditActorLabel (design §4.9)", () => {
  it.each([
    [
      { actorType: "admin", actorEmail: "you@example.com", actorSource: null },
      "admin · you@example.com",
    ],
    [
      {
        actorType: "creator",
        actorEmail: "maya@example.com",
        actorSource: null,
      },
      "creator · maya@example.com",
    ],
    [
      { actorType: "system", actorEmail: null, actorSource: "auto_approve" },
      "system · auto_approve",
    ],
    [
      { actorType: "cron", actorEmail: null, actorSource: null },
      "system · cron",
    ],
    [
      { actorType: "stripe", actorEmail: null, actorSource: null },
      "system · webhook",
    ],
    [{ actorType: "buyer", actorEmail: null, actorSource: null }, "buyer"],
  ] as const)("%o → %s", (actor, want) => {
    expect(auditActorLabel(actor)).toBe(want);
  });

  it("labels every actor type", () => {
    for (const actorType of AUDIT_ACTOR_TYPES) {
      expect(
        auditActorLabel({ actorType, actorEmail: null, actorSource: null }),
      ).toMatch(/^[a-z]+( · [a-z]+)?$/);
    }
  });
});
