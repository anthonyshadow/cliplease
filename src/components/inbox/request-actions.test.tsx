// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ApproveResult,
  CreatorRequest,
} from "@/lib/licensing/request-dto";
import {
  pressApprove,
  WAITING_REQUEST,
} from "../../../tests/helpers/inbox-fixtures";
import { REQUEST_STATUS_ID, RequestActions } from "./request-actions";

const mocks = vi.hoisted(() => ({ approveRequest: vi.fn() }));
vi.mock("@/app/(dashboard)/dashboard/actions", () => ({
  approveRequest: mocks.approveRequest,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const waiting = WAITING_REQUEST;

/** The page: its status block, then the action row, as the server renders them. */
function Page({
  request,
  notice = false,
}: {
  request: CreatorRequest;
  notice?: boolean;
}) {
  return (
    <>
      <div id={REQUEST_STATUS_ID} tabIndex={-1} />
      <RequestActions request={request} payoutsNotice={notice} />
    </>
  );
}

async function tapWith(result: ApproveResult) {
  mocks.approveRequest.mockResolvedValue({ ok: true, data: result });
  await pressApprove();
}

describe("RequestActions (05 §6.4)", () => {
  it("shows Approve while the request waits, and nothing once it is decided", () => {
    const view = render(<Page request={waiting} />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    view.rerender(
      <Page
        request={{ ...waiting, status: "approved", displayStatus: "approved" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    view.rerender(
      <Page request={{ ...waiting, displayStatus: "processing" }} />,
    );
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("after an approval leaves the line to the refreshed page and moves the focus to its status", async () => {
    const view = render(<Page request={waiting} />);
    await tapWith({ ok: true, licenseCode: "CL-7K3M-9QXA" });
    view.rerender(
      <Page
        request={{
          ...waiting,
          status: "approved",
          displayStatus: "approved",
          licenseCode: "CL-7K3M-9QXA",
        }}
      />,
    );
    expect(screen.queryByText(/License CL-7K3M-9QXA issued/)).toBeNull();
    expect(document.activeElement?.id).toBe(REQUEST_STATUS_ID);
  });

  it("keeps the late tap's line while the request still waits, without Approve, focused (07 D25)", async () => {
    render(<Page request={waiting} />);
    await tapWith({
      ok: false,
      reason: "expired",
      status: "awaiting_approval",
    });
    const line = screen.getByText("This request expired.");
    expect(line.closest("[tabindex]")).toBe(document.activeElement);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("doesn't repeat the payouts Notice the page already shows, and keeps Approve", async () => {
    render(<Page request={waiting} notice />);
    await tapWith({
      ok: false,
      reason: "payouts_not_active",
      status: "awaiting_approval",
    });
    expect(screen.queryByText(/Finish payout setup/)).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });
});
