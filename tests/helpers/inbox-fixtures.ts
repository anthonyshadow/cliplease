// The creator's request as the Inbox and the request page get it, Approve's and Decline's taps and their answer held
// back, for their component tests (the DOM helpers are sheet-dom's).
import type { Mock } from "vitest";
import type {
  ApproveResult,
  CreatorRequest,
  DeclineResult,
} from "../../src/lib/licensing/request-dto";
import { answered, holdAnswer as holdActionAnswer, press } from "./sheet-dom";

/** 05 §4.1's demo request, waiting: Paid social ads · 1 year · Worldwide, CA$1,575.00 to the creator. */
export const WAITING_REQUEST: CreatorRequest = {
  id: "7d3c0a52-5b1e-4f7e-9f61-0d6f4a1b2c3d",
  status: "awaiting_approval",
  displayStatus: "awaiting_approval",
  statusReason: null,
  scope: "Paid social ads · 1 year · Worldwide",
  licensePriceCents: 157500,
  amountTotalCents: 173250,
  currency: "cad",
  expiresAt: "2026-10-30T19:10:00.000Z",
  videoId: "0b9c5b6e-5b8f-4a52-9d3b-7c1d2e3f4a5b",
  title: "First snow",
  posterUrl: null,
  handle: "maya",
  slug: "first-snow",
  licenseCode: null,
  licenseeName: "Daily Laughs Media LLC",
  contactName: "Jordan Lee",
  intendedUse: "Instagram + TikTok ads, Q4 campaign",
  createdAt: "2026-10-27T19:10:00.000Z",
  exclusive: false,
  exclusiveMultiplierBps: 10000,
  approveEndsAt: null,
  transferStatus: null,
  transferAmountCents: null,
  transferCurrency: null,
  takenBack: false,
  autoApproveFallbackAt: null,
  autoApproved: false,
};

/** The demo request as an exclusive one at ×3.00, waiting: its license would end on 20 Nov 2027 if approved now. */
export const WAITING_EXCLUSIVE_REQUEST: CreatorRequest = {
  ...WAITING_REQUEST,
  scope: "Exclusive · Paid social ads · 1 year · Worldwide",
  exclusive: true,
  exclusiveMultiplierBps: 30000,
  approveEndsAt: "2027-11-20T15:00:00.000Z",
};

/** The line approving WAITING_EXCLUSIVE_REQUEST's row and page print. */
export const WAITING_EXCLUSIVE_LINE =
  "Exclusive request. If you approve, no one else can license this video until 20 Nov 2027.";

/** Taps Approve (in `container`, else the page) and lets the action's answer render. */
export const pressApprove = (container?: HTMLElement) =>
  press("Approve", container ?? document.body);

/** Taps Decline (in `container`, else the page) and lets the action's answer render. */
export const pressDecline = (container?: HTMLElement) =>
  press("Decline", container ?? document.body);

/**
 * Holds back Approve's or Decline's answer, each call's until the mock is set again: returns the call that answers
 * with `result` and lets it render.
 */
export function holdAnswer(action: Mock) {
  const answer = holdActionAnswer(action, { every: true });
  return (result: ApproveResult | DeclineResult) => answer(answered(result));
}
