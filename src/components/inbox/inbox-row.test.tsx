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
import { formatDeadline } from "@/lib/format";
import { approveOutcome, declineOutcome } from "@/lib/licensing/inbox";
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
import { InboxList } from "./inbox-list";
import { InboxRow } from "./inbox-row";
import { RequestFacts } from "./request-facts";

const mocks = vi.hoisted(() => ({
  approveRequest: vi.fn(),
  declineRequest: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/app/(dashboard)/dashboard/actions", () => ({
  approveRequest: mocks.approveRequest,
  declineRequest: mocks.declineRequest,
}));
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: mocks.refresh }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** The action answering `result` (the domain's, as data). */
const answers = (result: ApproveResult) =>
  mocks.approveRequest.mockResolvedValue({ ok: true, data: result });
const declineAnswers = (result: DeclineResult) =>
  mocks.declineRequest.mockResolvedValue({ ok: true, data: result });

const waiting = WAITING_REQUEST;
const other: CreatorRequest = {
  ...waiting,
  id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  licenseeName: "Second Buyer Inc.",
};
const EXPIRES_AT = waiting.expiresAt as string;
const viewerDeadline = formatDeadline(
  new Date(EXPIRES_AT),
  Intl.DateTimeFormat().resolvedOptions().timeZone,
);

const inList = (request: CreatorRequest) =>
  render(
    <ul>
      <InboxRow request={request} />
    </ul>,
  );

/** The list's first row (never the first `li`: the Toaster lists its toasts as `li`s too). */
const firstRow = (container: HTMLElement) =>
  container.querySelector("[data-inbox-row]") as HTMLElement;

/** The facts as label → value. */
function factsOf(container: HTMLElement) {
  const out: Record<string, string> = {};
  for (const dt of container.querySelectorAll("dt")) {
    out[dt.textContent ?? ""] = dt.nextElementSibling?.textContent ?? "";
  }
  return out;
}

describe("InboxRow (04 §9.11; 05 §6.3)", () => {
  it("shows a waiting request's licensee, scope, title with what the creator gets, a countdown and Details", () => {
    const { container } = inList(waiting);
    const row = within(firstRow(container));
    expect(row.getByText("Daily Laughs Media LLC")).toBeTruthy();
    expect(row.getByText("Paid social ads · 1 year · Worldwide")).toBeTruthy();
    expect(row.getByText("First snow · You get CA$1,575.00")).toBeTruthy();
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(
      EXPIRES_AT,
    );
    // Once per tier (the other copy hidden by CSS, which jsdom doesn't load).
    expect(row.getAllByRole("button", { name: "Details" })).toHaveLength(2);
    expect(row.getByRole("button", { name: "Decline" })).toBeTruthy();
    expect(row.getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("puts Decline (secondary) before Approve (primary), between the two tiers' Details (04 §9.11; 07 D146)", () => {
    inList(waiting);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("data-variant"))).toEqual([
      "tertiary",
      "secondary",
      "primary",
      "tertiary",
    ]);
    expect(buttons[1]).toBe(screen.getByRole("button", { name: "Decline" }));
    expect(buttons[2]).toBe(screen.getByRole("button", { name: "Approve" }));
  });

  it("shows an overdue request its expiry hasn't stored yet as Expired: no sentence, no You get, no actions, Details kept (owner answer Q-142 a)", () => {
    const { container } = inList({ ...waiting, displayStatus: "expired" });
    const row = within(firstRow(container));
    expect(row.getByText("Expired")).toBeTruthy();
    expect(container.querySelector("time")).toBeNull();
    expect(row.queryByText(/wasn't charged/)).toBeNull();
    expect(row.getByText("Paid social ads · 1 year · Worldwide")).toBeTruthy();
    expect(row.getByText("First snow · CA$1,575.00")).toBeTruthy();
    expect(row.queryByRole("button", { name: "Decline" })).toBeNull();
    expect(row.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(row.getAllByRole("button", { name: "Details" })).toHaveLength(1);
  });

  it("reads Processing… for a claimed request, with no countdown and no Approve or Decline (07 D26)", () => {
    const { container } = inList({ ...waiting, displayStatus: "processing" });
    expect(screen.getByText("Processing…")).toBeTruthy();
    expect(container.querySelector("time")).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("shows a History row's price without 'You get', its pill, its code and no Details", () => {
    inList({
      ...waiting,
      status: "approved",
      displayStatus: "approved",
      licenseCode: "CL-7K3M-9QXA",
    });
    expect(screen.getByText("First snow · CA$1,575.00")).toBeTruthy();
    expect(screen.queryByText(/You get/)).toBeNull();
    expect(
      screen.queryByText("Paid social ads · 1 year · Worldwide"),
    ).toBeNull();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText("CL-7K3M-9QXA")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("shows an expired request's line with its deadline", () => {
    inList({ ...waiting, status: "expired", displayStatus: "expired" });
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(
      screen.getByText(
        `Expired. No answer by ${viewerDeadline}. The buyer wasn't charged.`,
      ),
    ).toBeTruthy();
  });
});

describe("InboxRow after Approve (05 §6.3 States; 04 §10.3)", () => {
  it("keeps an approved row's waiting layout with the Approved pill, the seal before You get and the code line", () => {
    const { container } = render(
      <ul>
        <InboxRow
          request={waiting}
          outcome={approveOutcome(
            { ok: true, licenseCode: "CL-7K3M-9QXA" },
            waiting,
          )}
        />
      </ul>,
    );
    expect(
      screen.getByText("Paid social ads · 1 year · Worldwide"),
    ).toBeTruthy();
    const youGet = screen.getByText("First snow · You get CA$1,575.00");
    expect(youGet.querySelector("svg")?.getAttribute("width")).toBe("16");
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText("License CL-7K3M-9QXA issued")).toBeTruthy();
    expect(container.querySelector("time")).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  });

  it("settles a late tap with the Expired pill and says only that it expired (07 D25; Q-142 a)", () => {
    const { container } = render(
      <ul>
        <InboxRow
          request={waiting}
          outcome={approveOutcome(
            { ok: false, reason: "expired", status: "awaiting_approval" },
            waiting,
          )}
        />
      </ul>,
    );
    expect(container.querySelector("time")).toBeNull();
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByText("This request expired.")).toBeTruthy();
    expect(screen.queryByText(/wasn't charged/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("calls Approve once with the request, then shows retry's line, describes the focused status with it, and enables Approve again", async () => {
    answers({ ok: false, reason: "retry", status: "awaiting_approval" });
    const { container } = inList(waiting);
    await pressApprove();
    expect(mocks.approveRequest).toHaveBeenCalledWith({
      requestId: waiting.id,
    });
    const line = screen.getByText(
      "Couldn't reach the payment service. Try again.",
    );
    const status = container.querySelector("[data-row-status]");
    expect(document.activeElement).toBe(status);
    expect(status?.getAttribute("aria-describedby")).toBe(line.id);
    expect(
      (screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("links payout setup and names the deadline when payouts aren't active (01 J8.3)", async () => {
    answers({
      ok: false,
      reason: "payouts_not_active",
      status: "awaiting_approval",
    });
    inList(waiting);
    await pressApprove();
    expect(
      screen.getByText(
        `Finish payout setup to approve. This request stays open until ${viewerDeadline}.`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Set up payouts" }).getAttribute("href"),
    ).toBe("/dashboard/settings#payouts");
  });

  it("drops a line that left the row live once the row no longer waits: Expired or Processing… (Q-142 a)", async () => {
    answers({
      ok: false,
      reason: "payouts_not_active",
      status: "awaiting_approval",
    });
    const { container, rerender } = inList(waiting);
    await pressApprove();
    expect(screen.getByRole("link", { name: "Set up payouts" })).toBeTruthy();
    for (const displayStatus of ["expired", "processing"] as const) {
      rerender(
        <ul>
          <InboxRow request={{ ...waiting, displayStatus }} />
        </ul>,
      );
      expect(screen.queryByText(/Finish payout setup/)).toBeNull();
      expect(screen.queryByRole("link", { name: "Set up payouts" })).toBeNull();
      expect(
        container
          .querySelector("[data-row-status]")
          ?.getAttribute("aria-describedby"),
      ).toBeNull();
    }
  });

  it("names the support address when the original is missing (P18 Q1)", async () => {
    answers({
      ok: false,
      reason: "original_missing",
      status: "awaiting_approval",
    });
    inList(waiting);
    await pressApprove();
    expect(
      screen
        .getByRole("link", { name: "support@example.com" })
        .getAttribute("href"),
    ).toBe("mailto:support@example.com");
  });
});

describe("InboxRow after Decline (05 §6.3 States; 01 J8.4)", () => {
  /** The row's status, which takes the focus after a result. */
  const statusOf = (row: HTMLElement) =>
    row.querySelector("[data-row-status]") as HTMLElement;

  it("keeps a declined row's scope, prints its price without 'You get' or the seal, and shows the Declined pill and the line", () => {
    const { container } = render(
      <ul>
        <InboxRow request={waiting} outcome={declineOutcome({ ok: true })} />
      </ul>,
    );
    expect(
      screen.getByText("Paid social ads · 1 year · Worldwide"),
    ).toBeTruthy();
    const price = screen.getByText("First snow · CA$1,575.00");
    expect(price.querySelector("svg")).toBeNull();
    expect(screen.queryByText(/You get/)).toBeNull();
    expect(screen.getByText("Declined")).toBeTruthy();
    expect(
      screen.getByText("Declined. The buyer wasn't charged."),
    ).toBeTruthy();
    expect(container.querySelector("time")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("disables Approve while Declining…, and Decline while Approving… (04 §9.11, §10.3)", async () => {
    inList(waiting);
    const decline = screen.getByRole("button", {
      name: "Decline",
    }) as HTMLButtonElement;
    const approve = screen.getByRole("button", {
      name: "Approve",
    }) as HTMLButtonElement;

    const declineAnswer = holdAnswer(mocks.declineRequest);
    act(() => {
      fireEvent.click(decline);
    });
    expect(decline.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: /Declining…/ })).toBe(decline);
    expect(approve.disabled).toBe(true);
    await declineAnswer({
      ok: false,
      reason: "retry",
      status: "awaiting_approval",
    });
    expect(decline.getAttribute("aria-busy")).toBeNull();
    expect(approve.disabled).toBe(false);

    const approveAnswer = holdAnswer(mocks.approveRequest);
    act(() => {
      fireEvent.click(approve);
    });
    expect(approve.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: /Approving…/ })).toBe(approve);
    expect(decline.disabled).toBe(true);
    await approveAnswer({
      ok: false,
      reason: "retry",
      status: "awaiting_approval",
    });
    expect(decline.disabled).toBe(false);
  });

  it("shows retry's line, describes the focused status with it, and enables both buttons again", async () => {
    declineAnswers({ ok: false, reason: "retry", status: "awaiting_approval" });
    const { container } = inList(waiting);
    await pressDecline();
    const line = screen.getByText(
      "Couldn't reach the payment service. Try again.",
    );
    const status = statusOf(container);
    expect(document.activeElement).toBe(status);
    expect(status.getAttribute("aria-describedby")).toBe(line.id);
    for (const name of ["Decline", "Approve"]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(false);
    }
    expect(screen.getByText("First snow · You get CA$1,575.00")).toBeTruthy();
  });

  it("keeps the declined row in place with its line, its pill and the same sentence as a toast, then lets it go at the next focus refresh", async () => {
    declineAnswers({ ok: true });
    const view = render(
      <>
        <Toaster />
        <InboxList rows={[waiting, other]} empty={null} />
      </>,
    );
    await pressDecline(firstRow(view.container));
    expect(mocks.declineRequest).toHaveBeenCalledTimes(1);
    expect(mocks.declineRequest).toHaveBeenCalledWith({
      requestId: waiting.id,
    });
    // The server's refresh no longer lists it…
    view.rerender(
      <>
        <Toaster />
        <InboxList rows={[other]} empty={null} />
      </>,
    );
    const names = () =>
      [...view.container.querySelectorAll("[data-licensee]")].map(
        (n) => n.textContent,
      );
    expect(names()).toEqual(["Daily Laughs Media LLC", "Second Buyer Inc."]);
    const declined = firstRow(view.container);
    const row = within(declined);
    const line = row.getByText("Declined. The buyer wasn't charged.");
    expect(row.getByText("Declined")).toBeTruthy();
    expect(row.queryAllByRole("button")).toHaveLength(0);
    expect(document.activeElement).toBe(statusOf(declined));
    expect(statusOf(declined).getAttribute("aria-describedby")).toBe(line.id);
    // The polite toast says the same, without the seal (04 §9.23).
    expect(latestToast()?.textContent).toBe(
      "Declined. The buyer wasn't charged.",
    );
    expect(latestToast()?.querySelector("svg")).toBeNull();
    // …until the window takes the focus again.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(mocks.refresh).toHaveBeenCalled();
    expect(names()).toEqual(["Second Buyer Inc."]);
  });

  it("settles a decline that found the request expired with the Expired pill and the stored sentence, and no toast (owner answer Q-143 a)", async () => {
    declineAnswers({ ok: false, reason: "not_actionable", status: "expired" });
    const view = render(
      <>
        <Toaster />
        <InboxList rows={[waiting]} empty={null} />
      </>,
    );
    const before = latestToast();
    await pressDecline();
    const settled = firstRow(view.container);
    const row = within(settled);
    expect(row.getByText("Expired")).toBeTruthy();
    const line = row.getByText(
      "This request expired. The buyer wasn't charged.",
    );
    expect(row.getByText("First snow · CA$1,575.00")).toBeTruthy();
    expect(row.queryAllByRole("button")).toHaveLength(0);
    expect(document.activeElement).toBe(statusOf(settled));
    expect(statusOf(settled).getAttribute("aria-describedby")).toBe(line.id);
    expect(latestToast()).toBe(before);
  });

  it("settles a decline that lost to an approval quietly with that pill: no line, no toast (J8.8)", async () => {
    declineAnswers({ ok: false, reason: "not_actionable", status: "approved" });
    const view = render(
      <>
        <Toaster />
        <InboxList rows={[waiting]} empty={null} />
      </>,
    );
    const before = latestToast();
    await pressDecline();
    const settled = firstRow(view.container);
    const row = within(settled);
    expect(row.getByText("Approved")).toBeTruthy();
    expect(row.queryByText(/wasn't charged|Try again/)).toBeNull();
    expect(row.queryAllByRole("button")).toHaveLength(0);
    expect(statusOf(settled).hasAttribute("aria-describedby")).toBe(false);
    expect(latestToast()).toBe(before);
  });
});

describe("InboxList's settled rows (02 §4.4 rule 2; 07 D160)", () => {
  it("keeps an approved row in place after the action's refresh drops it, and lets it go at the next focus refresh", async () => {
    answers({ ok: true, licenseCode: "CL-7K3M-9QXA" });
    const view = render(
      <>
        <Toaster />
        <InboxList rows={[waiting, other]} empty={null} />
      </>,
    );
    await pressApprove(firstRow(view.container));
    // The server's refresh no longer lists it…
    view.rerender(
      <>
        <Toaster />
        <InboxList rows={[other]} empty={null} />
      </>,
    );
    const names = () =>
      [...view.container.querySelectorAll("[data-licensee]")].map(
        (n) => n.textContent,
      );
    expect(names()).toEqual(["Daily Laughs Media LLC", "Second Buyer Inc."]);
    expect(screen.getByText("License CL-7K3M-9QXA issued")).toBeTruthy();
    // The polite toast, with its seal (04 §9.23).
    expect(latestToast()?.textContent).toBe(
      "Approved. CA$1,575.00 is on its way to your Stripe balance.",
    );
    expect(latestToast()?.querySelector("svg")).not.toBeNull();
    // …until the window takes the focus again.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(mocks.refresh).toHaveBeenCalled();
    expect(names()).toEqual(["Second Buyer Inc."]);
  });

  it("shows the empty state only once no row is held", async () => {
    answers({ ok: true, licenseCode: "CL-7K3M-9QXA" });
    const view = render(<InboxList rows={[waiting]} empty={<p>Empty</p>} />);
    await pressApprove();
    view.rerender(<InboxList rows={[]} empty={<p>Empty</p>} />);
    expect(screen.queryByText("Empty")).toBeNull();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(screen.getByText("Empty")).toBeTruthy();
  });

  it("holds a row while its action runs: a refresh during Approving… changes nothing", async () => {
    const answer = holdAnswer(mocks.approveRequest);
    const view = render(<InboxList rows={[waiting, other]} empty={null} />);
    act(() => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Approve" })[0] as HTMLElement,
      );
    });
    view.rerender(<InboxList rows={[other]} empty={null} />);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(screen.getAllByText("Approving…").length).toBeGreaterThan(0);
    expect(view.container.querySelectorAll("[data-inbox-row]")).toHaveLength(2);
    await answer({ ok: false, reason: "retry", status: "awaiting_approval" });
    // Not settled: the row follows the server's rows again.
    expect(view.container.querySelectorAll("[data-inbox-row]")).toHaveLength(1);
  });
});

describe("RequestFacts (04 §9.11; owner answer Q-128 a)", () => {
  it("lists every fact while the request waits, the deadline in the viewer's zone", () => {
    const { container } = render(<RequestFacts request={waiting} />);
    expect(factsOf(container)).toEqual({
      "Licensed to": "Daily Laughs Media LLC",
      Contact: "Jordan Lee",
      "Planned use": "Instagram + TikTok ads, Q4 campaign",
      Scope: "Paid social ads · 1 year · Worldwide",
      "You get": "CA$1,575.00 (buyer pays CA$1,732.50 incl. service fee)",
      Payment: "Card on hold. Charged only if you approve.",
      "Answer by": `${viewerDeadline}. If you don't answer, the hold is released.`,
    });
  });

  it("keeps 'You get' once approved, but not the hold or the deadline", () => {
    const { container } = render(
      <RequestFacts
        request={{ ...waiting, status: "approved", displayStatus: "approved" }}
      />,
    );
    expect(Object.keys(factsOf(container))).toEqual([
      "Licensed to",
      "Contact",
      "Planned use",
      "Scope",
      "You get",
    ]);
  });

  it.each(["declined", "expired", "capture_failed"] as const)(
    "drops what the creator gets, the hold and the deadline once %s",
    (status) => {
      const { container } = render(
        <RequestFacts
          request={{ ...waiting, status, displayStatus: status }}
        />,
      );
      expect(Object.keys(factsOf(container))).toEqual([
        "Licensed to",
        "Contact",
        "Planned use",
        "Scope",
      ]);
    },
  );

  it("drops what the creator gets, the hold and the deadline once overdue, before the expiry is stored (owner answer Q-142 a)", () => {
    const { container } = render(
      <RequestFacts request={{ ...waiting, displayStatus: "expired" }} />,
    );
    expect(Object.keys(factsOf(container))).toEqual([
      "Licensed to",
      "Contact",
      "Planned use",
      "Scope",
    ]);
  });

  it("keeps every fact while a claim runs (07 D26)", () => {
    const { container } = render(
      <RequestFacts request={{ ...waiting, displayStatus: "processing" }} />,
    );
    expect(Object.keys(factsOf(container))).toContain("Answer by");
  });

  it("leaves out Planned use when the buyer gave none", () => {
    const { container } = render(
      <RequestFacts request={{ ...waiting, intendedUse: null }} />,
    );
    expect(factsOf(container)).not.toHaveProperty("Planned use");
  });
});
