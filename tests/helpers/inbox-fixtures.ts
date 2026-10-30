// The creator's request as the Inbox and the request page get it, and Approve's tap, for their component tests.
import { act, fireEvent, screen, within } from "@testing-library/react";
import type { CreatorRequest } from "../../src/lib/licensing/request-dto";

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

/** Taps Approve (in `container`, else the page) and lets the action's answer render. */
export async function pressApprove(container?: HTMLElement) {
  const scope = container ? within(container) : screen;
  await act(async () => {
    fireEvent.click(scope.getByRole("button", { name: "Approve" }));
  });
}
