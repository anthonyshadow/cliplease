// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/toast";
import type {
  ApproveResult,
  CreatorRequest,
  DeclineResult,
} from "@/lib/licensing/request-dto";
import {
  holdAnswer,
  latestToast,
  pressApprove,
  pressDecline,
  WAITING_REQUEST,
} from "../../../tests/helpers/inbox-fixtures";
import { REQUEST_STATUS_ID, RequestActions } from "./request-actions";

const mocks = vi.hoisted(() => ({
  approveRequest: vi.fn(),
  declineRequest: vi.fn(),
}));
vi.mock("@/app/(dashboard)/dashboard/actions", () => ({
  approveRequest: mocks.approveRequest,
  declineRequest: mocks.declineRequest,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const waiting = WAITING_REQUEST;

/** The page as the server renders it: the status block, then the action row, in `main`; the layout's Toaster after. */
function Page({
  request,
  notice = false,
}: {
  request: CreatorRequest;
  notice?: boolean;
}) {
  return (
    <>
      <main>
        <div id={REQUEST_STATUS_ID} tabIndex={-1} />
        <RequestActions request={request} payoutsNotice={notice} />
      </main>
      <Toaster />
    </>
  );
}

/** The page's own content, without the toasts. */
const main = () => within(screen.getByRole("main"));

async function tapWith(result: ApproveResult) {
  mocks.approveRequest.mockResolvedValue({ ok: true, data: result });
  await pressApprove();
}

async function declineWith(result: DeclineResult) {
  mocks.declineRequest.mockResolvedValue({ ok: true, data: result });
  await pressDecline();
}

describe("RequestActions (05 §6.4)", () => {
  it("shows Decline, then Approve, while the request waits, and neither once it is decided, claimed or overdue", () => {
    const view = render(<Page request={waiting} />);
    const buttons = main().getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("data-variant"))).toEqual([
      "secondary",
      "primary",
    ]);
    expect(buttons[0]).toBe(main().getByRole("button", { name: "Decline" }));
    expect(buttons[1]).toBe(main().getByRole("button", { name: "Approve" }));
    for (const request of [
      { ...waiting, status: "approved", displayStatus: "approved" },
      { ...waiting, displayStatus: "processing" },
      { ...waiting, displayStatus: "expired" },
    ] as const) {
      view.rerender(<Page request={request} />);
      expect(main().queryAllByRole("button")).toHaveLength(0);
    }
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

  it("keeps the late tap's line while the request still waits, without Decline or Approve, focused (07 D25)", async () => {
    render(<Page request={waiting} />);
    await tapWith({
      ok: false,
      reason: "expired",
      status: "awaiting_approval",
    });
    const line = screen.getByText("This request expired.");
    expect(line.closest("[tabindex]")).toBe(document.activeElement);
    expect(main().queryAllByRole("button")).toHaveLength(0);
  });

  it("doesn't repeat the payouts Notice the page already shows, and keeps Decline and Approve", async () => {
    render(<Page request={waiting} notice />);
    await tapWith({
      ok: false,
      reason: "payouts_not_active",
      status: "awaiting_approval",
    });
    expect(screen.queryByText(/Finish payout setup/)).toBeNull();
    expect(main().getByRole("button", { name: "Decline" })).toBeTruthy();
    expect(main().getByRole("button", { name: "Approve" })).toBeTruthy();
  });
});

describe("RequestActions after Decline (05 §6.4; 01 J8.4)", () => {
  it("declines this request, then keeps its line through the refresh, focused, with the same sentence as a toast", async () => {
    const view = render(<Page request={waiting} />);
    await declineWith({ ok: true });
    expect(mocks.declineRequest).toHaveBeenCalledTimes(1);
    expect(mocks.declineRequest).toHaveBeenCalledWith({
      requestId: waiting.id,
    });
    // The refreshed record shows only the pill: the line is the action's to keep.
    view.rerender(
      <Page
        request={{
          ...waiting,
          status: "declined",
          displayStatus: "declined",
          statusReason: "creator",
        }}
      />,
    );
    const line = main().getByText("Declined. The buyer wasn't charged.");
    expect(line.closest("[tabindex]")).toBe(document.activeElement);
    expect(main().queryAllByRole("button")).toHaveLength(0);
    expect(latestToast()?.textContent).toBe(
      "Declined. The buyer wasn't charged.",
    );
    expect(latestToast()?.querySelector("svg")).toBeNull();
  });

  it("disables Approve while Declining…, and Decline while Approving… (04 §9.11)", async () => {
    render(<Page request={waiting} />);
    const decline = main().getByRole("button", {
      name: "Decline",
    }) as HTMLButtonElement;
    const approve = main().getByRole("button", {
      name: "Approve",
    }) as HTMLButtonElement;
    const retry = {
      ok: false,
      reason: "retry",
      status: "awaiting_approval",
    } as const;

    const declineAnswer = holdAnswer(mocks.declineRequest);
    act(() => {
      fireEvent.click(decline);
    });
    expect(decline.getAttribute("aria-busy")).toBe("true");
    expect(approve.disabled).toBe(true);
    await declineAnswer(retry);
    expect(approve.disabled).toBe(false);

    const approveAnswer = holdAnswer(mocks.approveRequest);
    act(() => {
      fireEvent.click(approve);
    });
    expect(approve.getAttribute("aria-busy")).toBe("true");
    expect(decline.disabled).toBe(true);
    await approveAnswer(retry);
    expect(decline.disabled).toBe(false);
  });

  it("shows retry's line, focused, with Decline and Approve back", async () => {
    render(<Page request={waiting} />);
    await declineWith({
      ok: false,
      reason: "retry",
      status: "awaiting_approval",
    });
    const line = main().getByText(
      "Couldn't reach the payment service. Try again.",
    );
    expect(line.closest("[tabindex]")).toBe(document.activeElement);
    expect(main().getAllByRole("button")).toHaveLength(2);
  });

  it("leaves a stored expiry's sentence to the refreshed record and focuses the status block, no toast (owner answer Q-143 a)", async () => {
    const view = render(<Page request={waiting} />);
    const before = latestToast();
    await declineWith({
      ok: false,
      reason: "not_actionable",
      status: "expired",
    });
    for (const request of [
      waiting,
      {
        ...waiting,
        status: "expired",
        displayStatus: "expired",
        statusReason: "deadline",
      },
    ] as const) {
      view.rerender(<Page request={request} />);
      expect(main().queryByText(/wasn't charged/)).toBeNull();
      expect(main().queryAllByRole("button")).toHaveLength(0);
      expect(document.activeElement?.id).toBe(REQUEST_STATUS_ID);
    }
    expect(latestToast()).toBe(before);
  });

  it("settles a decline that lost to an approval quietly: no line, the focus on the status block, no toast (J8.8)", async () => {
    render(<Page request={waiting} />);
    const before = latestToast();
    await declineWith({
      ok: false,
      reason: "not_actionable",
      status: "approved",
    });
    expect(main().queryByText(/wasn't charged|Try again/)).toBeNull();
    expect(main().queryAllByRole("button")).toHaveLength(0);
    expect(document.activeElement?.id).toBe(REQUEST_STATUS_ID);
    expect(latestToast()).toBe(before);
  });
});
