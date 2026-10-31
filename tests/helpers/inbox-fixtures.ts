// The creator's request as the Inbox and the request page get it, Approve's and Decline's taps, an answer held back
// and the newest toast, for their component tests.
import { act, fireEvent, screen, within } from "@testing-library/react";
import type { Mock } from "vitest";
import type {
  ApproveResult,
  CreatorRequest,
  DeclineResult,
} from "../../src/lib/licensing/request-dto";

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
};

/** Taps the button named `name` (in `container`, else the page) and lets the action's answer render. */
async function press(name: string, container?: HTMLElement) {
  const scope = container ? within(container) : screen;
  await act(async () => {
    fireEvent.click(scope.getByRole("button", { name }));
  });
}

export const pressApprove = (container?: HTMLElement) =>
  press("Approve", container);

export const pressDecline = (container?: HTMLElement) =>
  press("Decline", container);

/** Holds back a mocked Server Action's answer: returns the call that answers with `result` and lets it render. */
export function holdAnswer(action: Mock) {
  let answer: (value: unknown) => void = () => {};
  action.mockReturnValue(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  return (result: ApproveResult | DeclineResult) =>
    act(async () => {
      answer({ ok: true, data: result });
    });
}

/**
 * The newest toast: the last item of the Toaster's list (Radix renders each toast as an `li` of the viewport's `ol`).
 * The toast store outlives a test, so a file's earlier toasts are still listed: compare the last one, never a count.
 */
export const latestToast = () =>
  [...document.querySelectorAll("ol > li")].at(-1) ?? null;
