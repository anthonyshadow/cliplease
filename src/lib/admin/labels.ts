// The admin view's labels (05 §7; design/P21-admin-view.md §4.8, §4.9; owner answer Q-199 a): the Events flags, and the
// words for the cells that print a status or a movement. The disable reasons' labels are the creator's Review Banner's
// (VIDEO_DISABLED_REASON_LABELS, src/lib/videos/review.ts). Pure and client-safe.
import {
  type AuditActorType,
  type Currency,
  isOneOf,
  type LicenseRequestStatus,
  type MoneyMovementStatus,
  type PayoutsStatus,
  type SocialAccountStatus,
} from "../domain/values";
import { formatMoney } from "../format";
import { requestPill } from "../licensing/inbox";
import { PAYOUTS_STATUS_LABEL } from "../payouts";

/**
 * The audit actions Events shows flagged (05 §7; 07 D68, D75, D81, D111, D127): money that moved or failed to, a
 * fallback, a conflict, a license not written after the money was taken. `video_posting.released` reads as a normal
 * row. P22h adds the renewal flags here.
 */
export const ADMIN_EVENT_FLAGS = [
  "license_request.money_moved_late",
  "license_request.cancel_failed",
  "license_request.transfer_failed",
  "license_request.auto_approve_fallback",
  "license_request.exclusive_conflict",
  "video_posting.conflict",
  "license_request.issue_failed",
  "stripe_event.currency_mismatch",
  "connect.negative_balance_debits_failed",
] as const;

/** Whether Events shows audit action `action` flagged (red, a warning icon and "Flagged" for screen readers). */
export const isAdminEventFlag = (action: string): boolean =>
  isOneOf(ADMIN_EVENT_FLAGS, action);

/** The pill tones 04 §9.9 names, StatusPill's own: StatusCell passes them through. */
type AdminPillTone = "neutral" | "awaiting" | "cleared" | "danger";

/** A status cell: a 04 §9.9 pill, or the raw value in ink-2 where 04 has no pill for it (design §4.8). */
export type AdminStatusCell =
  | { kind: "pill"; label: string; tone: AdminPillTone; dot?: "solid" }
  | { kind: "raw"; text: string };

const pill = (
  label: string,
  tone: AdminPillTone,
  dot?: "solid",
): AdminStatusCell => ({ kind: "pill", label, tone, dot });

/**
 * A request's status cell (04 §9.9): the creator's pill (requestPill), Processing… while a claim holds a waiting request
 * (07 D26), Approved, Declined, Expired, Payment failed; checkout_pending, awaiting_approval, abandoned and the renewal
 * statuses print raw.
 */
export function adminRequestStatus(r: {
  status: LicenseRequestStatus;
  claimed: boolean;
}): AdminStatusCell {
  const shown = requestPill(
    r.status === "awaiting_approval" && r.claimed ? "processing" : r.status,
  );
  return shown
    ? pill(shown.label, shown.tone)
    : { kind: "raw", text: r.status };
}

/** A connected account's status cell (04 §9.9; 05 §1.5): Connected, Sync problem, Needs reconnect, or disconnected raw. */
export function adminAccountStatus(a: {
  status: SocialAccountStatus;
  syncProblem: boolean;
}): AdminStatusCell {
  if (a.syncProblem) return pill("Sync problem", "awaiting");
  switch (a.status) {
    case "connected":
      return pill("Connected", "neutral", "solid");
    case "needs_reconnect":
      return pill("Needs reconnect", "awaiting");
    case "disconnected":
      return { kind: "raw", text: a.status };
  }
}

/** Each payouts status's pill tone on the Creators tab, as the canvas draws it (design §6.2). */
const PAYOUTS_TONE = {
  not_started: "neutral",
  pending: "awaiting",
  active: "cleared",
  restricted: "awaiting",
  rejected: "danger",
  unsupported: "danger",
} as const satisfies Record<PayoutsStatus, AdminPillTone>;

/**
 * A creator's Payouts cell (design §6.2): Settings' words (01 J11.1) on a pill: Payouts on filled, Stripe still
 * checking or asking for more in awaiting, Payouts unavailable in danger, Not set up neutral.
 */
export function adminPayoutsStatus(status: PayoutsStatus): AdminStatusCell {
  return pill(PAYOUTS_STATUS_LABEL[status], PAYOUTS_TONE[status]);
}

/** The Requests tab's Auto-approve cell (07 D81): "on", "on · fell back", or null (off: the page prints "—"). */
export function autoApproveLabel(r: {
  autoApprove: boolean;
  autoApproveFellBack: boolean;
}): string | null {
  if (!r.autoApprove) return null;
  return r.autoApproveFellBack ? "on · fell back" : "on";
}

/**
 * The Licenses tab's Transfer cell (05 §7 callout 7; owner answer Q-199 a): "Transfer CA$1,575.00 sent", "Transfer
 * pending", "Transfer failed (account_closed)" ("Transfer failed" without a stored code). Null without a creator
 * transfer, or for a canceled one (P21b owns the revoke copy, as payoutLine).
 */
export function transferLabel(
  t: {
    status: MoneyMovementStatus;
    amountCents: number;
    currency: Currency;
    lastError: string | null;
  } | null,
): string | null {
  if (!t) return null;
  switch (t.status) {
    case "succeeded":
      return `Transfer ${formatMoney(t.amountCents, t.currency)} sent`;
    case "pending":
      return "Transfer pending";
    case "failed":
      return t.lastError
        ? `Transfer failed (${t.lastError})`
        : "Transfer failed";
    case "canceled":
      return null;
  }
}

/**
 * An audit row's Actor cell (design §4.9): its type, then the user's email when there is one, else the system's source
 * ("admin · you@example.com", "system · auto_approve"); the cron and Stripe's webhook are system work ("system · cron",
 * "system · webhook").
 */
export function auditActorLabel(e: {
  actorType: AuditActorType;
  actorEmail: string | null;
  actorSource: string | null;
}): string {
  switch (e.actorType) {
    case "cron":
      return "system · cron";
    case "stripe":
      return "system · webhook";
    default: {
      const who = e.actorEmail ?? e.actorSource;
      return who ? `${e.actorType} · ${who}` : e.actorType;
    }
  }
}
