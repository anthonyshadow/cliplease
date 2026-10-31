import type {
  Currency,
  LicenseRequestStatus,
  MoneyMovementStatus,
} from "@/lib/domain/values";
import type { DisplayStatus } from "./transitions";

// What the request pages get of a request (02 §4.1; 03 §7.1, §7.6): plain values, instants as ISO strings, mapped field
// by field from the row, so nothing private rides along. Never the buyer's email, key, IP or Stripe ids (07 D47; 02
// §9.11). Client components import these types; the queries are src/server/licensing/queries.ts.

type RequestFacts = {
  id: string;
  status: LicenseRequestStatus;
  displayStatus: DisplayStatus;
  /** Why it ended (07 D27, D28): the copy for abandoned and declined requests depends on it. */
  statusReason: string | null;
  /** "Paid social ads · 1 year · France" (scopeLabel), built on the server: the pages' client code loads no countries. */
  scope: string;
  licensePriceCents: number;
  amountTotalCents: number;
  currency: Currency;
  /** The approval deadline; null until the card is held. */
  expiresAt: string | null;
  videoId: string;
  title: string;
  /** null without a poster, and on /r while the video isn't public (its poster would 404). */
  posterUrl: string | null;
  handle: string;
  slug: string;
  /** The license's code once one is issued (P18). */
  licenseCode: string | null;
};

/** /r's request (S03). */
export type BuyerStatus = RequestFacts & {
  /**
   * /r's one auto-approve fact (owner answer Q-155/T6-09): the automatic approval may still run, so /r shows
   * Processing… without a deadline; never the fallback instant.
   */
  autoApproving: boolean;
};

/**
 * A request in the creator's inbox and on its page (S14, S15): the buyer's entries, but never their email; and once it
 * is approved, its creator transfer for the payout line (P19b; 07 D75): status, amount and currency only, never its
 * Stripe id or error. The three are null together until T5 leaves the row.
 */
export type CreatorRequest = RequestFacts & {
  licenseeName: string;
  contactName: string;
  intendedUse: string | null;
  createdAt: string;
  transferStatus: MoneyMovementStatus | null;
  transferAmountCents: number | null;
  transferCurrency: Currency | null;
  /** Set once auto-approve fell back: the row's fallback line (07 D81). ISO 8601; null otherwise. */
  autoApproveFallbackAt: string | null;
  /** Approved by auto-approve: approved, auto_approve, no fallback (05 §6.3 callout 12). */
  autoApproved: boolean;
};

/** The inbox's two lists (05 §6.3). */
export const INBOX_VIEWS = ["waiting", "history"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

/** Why Approve didn't approve (02 §5.7, §8.2; 04 §11.5). P19g adds the exclusive conflict. */
export type ApproveRefusal =
  | "not_actionable"
  | "expired"
  | "retry"
  | "capture_failed"
  | "payouts_not_active"
  | "original_missing";

/**
 * What Approve returns (02 §5.7): the license's code, or why not with the request's status as it is now (null when the
 * request isn't the caller's to approve: nothing about it is told).
 */
export type ApproveResult =
  | { ok: true; licenseCode: string }
  | { ok: false; reason: ApproveRefusal; status: LicenseRequestStatus | null };

/** Why Decline didn't decline (02 §5.7, §8.2): another claim or an ending got there first, or Stripe can't be reached. */
export type DeclineRefusal = "not_actionable" | "retry";

/**
 * What Decline returns (02 §5.7): ok only once the request is stored as declined, so "wasn't charged" follows Stripe's
 * cancel (07 D25); else why not with the request's status as it is now (null when it isn't the caller's, as Approve).
 */
export type DeclineResult =
  | { ok: true }
  | { ok: false; reason: DeclineRefusal; status: LicenseRequestStatus | null };
