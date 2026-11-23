// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDeadline } from "@/lib/format";
import {
  AUDIT_ROW,
  CONNECTION,
  CREATED_TEXT,
  CREATOR,
  DECLINED_REQUEST,
  DISABLED_VIDEO,
  EVENTS,
  FAILED_MOVEMENT,
  FAILED_RETURNS_LICENSE,
  FAILED_TRANSFER_LICENSE,
  FLAGGED_AUDIT_ROW,
  LIVE_VIDEO,
  REFUNDED_LICENSE,
  STRIPE_EVENT,
  VALID_LICENSE,
  WAITING_REQUEST,
} from "../../../../tests/helpers/admin-fixtures";
import { AdminTable } from "./admin-cells";
import { CONNECTION_COLUMNS } from "./connections-table";
import { CREATOR_COLUMNS } from "./creators-table";
import { EventsLists } from "./events-lists";
import { LICENSE_COLUMNS } from "./licenses-table";
import { REQUEST_COLUMNS } from "./requests-table";
import { VIDEO_COLUMNS } from "./videos-table";

vi.mock("@/app/admin/actions", () => ({
  adminDisableVideo: vi.fn(),
  adminEnableVideo: vi.fn(),
  adminRevokeLicense: vi.fn(),
  adminRetryMoneyMovement: vi.fn(),
}));

afterEach(cleanup);

/** The table form (from lg): its header words and each row's cells' text. */
function table(ui: ReactElement, name?: string) {
  const view = render(ui);
  const wide = name
    ? within(view.container).getByRole("table", { name })
    : within(view.container).getByRole("table");
  const [head, ...body] = within(wide).getAllByRole("row");
  return {
    view,
    wide,
    headers: within(head)
      .getAllByRole("columnheader")
      .map((th) => th.textContent),
    rows: body.map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent),
    ),
    cells: body.map((tr) => [...tr.querySelectorAll("td")]),
  };
}

describe("the admin tables (05 §7; design/P21-admin-view.md §6)", () => {
  it("Creators: the payout currency in words, the payouts pill, the video count, the time in UTC", () => {
    const { headers, rows, cells } = table(
      <AdminTable
        caption="Creators"
        columns={CREATOR_COLUMNS}
        rows={[CREATOR]}
      />,
      "Creators",
    );
    expect(headers).toEqual([
      "Handle",
      "Name",
      "Email",
      "Payout currency",
      "Payouts",
      "Videos",
      "Created",
    ]);
    expect(rows).toEqual([
      [
        "@maya",
        "Maya Reyes",
        "maya@example.com",
        "Canadian dollars (CAD)",
        "Payouts on",
        "3",
        CREATED_TEXT,
      ],
    ]);
    expect(cells[0][5].className).toContain("tabular-nums");
  });

  it("Accounts: the platform's name, @username, the pill or the raw status, and — for what's missing", () => {
    const { headers, rows } = table(
      <AdminTable
        caption="Accounts"
        columns={CONNECTION_COLUMNS}
        rows={[
          CONNECTION,
          {
            ...CONNECTION,
            id: "a0000000-0000-4000-8000-000000000002",
            username: null,
            status: "disconnected",
            lastSyncedAt: null,
            lastSyncError: "rate_limited",
            disconnectedAt: CONNECTION.connectedAt,
          },
        ]}
      />,
      "Accounts",
    );
    expect(headers).toEqual([
      "Platform",
      "Username",
      "Owner",
      "Status",
      "Last sync",
      "Last error",
      "Connected",
      "Disconnected",
    ]);
    expect(rows).toEqual([
      [
        "Demo",
        "@demo.creator",
        "@maya",
        "Connected",
        CREATED_TEXT,
        "—",
        CREATED_TEXT,
        "—",
      ],
      [
        "Demo",
        "—",
        "@maya",
        "disconnected",
        "—",
        "rate_limited",
        CREATED_TEXT,
        CREATED_TEXT,
      ],
    ]);
  });

  it("Videos: ownership by the verified platform, postings, the status pill, Waiting, the reason with the note, the action", () => {
    const { headers, rows, wide } = table(
      <AdminTable
        caption="Videos"
        columns={VIDEO_COLUMNS}
        rows={[LIVE_VIDEO, DISABLED_VIDEO]}
      />,
      "Videos",
    );
    expect(headers).toEqual([
      "Title",
      "Creator",
      "Ownership",
      "Postings",
      "Status",
      "Waiting",
      "Reason",
      "Created",
      "Action",
    ]);
    expect(rows).toEqual([
      [
        "First snow",
        "@maya",
        "Verified · Demo",
        "3 · 2 verified",
        "Live",
        "2",
        "—",
        CREATED_TEXT,
        "Disable",
      ],
      [
        "Rooftop storm timelapse",
        "@maya",
        "Self-attested",
        "2 · 0 verified",
        "Disabled by ClipLease",
        "0",
        "Rights claimNote: ticket-4821",
        CREATED_TEXT,
        "Enable",
      ],
    ]);
    expect(
      within(wide).getByRole("button", { name: "Disable First snow" }),
    ).toBeTruthy();
    expect(
      within(wide).getByRole("button", {
        name: "Enable Rooftop storm timelapse",
      }),
    ).toBeTruthy();
  });

  it("Videos, stacked: each row its own action, a live video without the Reason label", () => {
    const { view } = table(
      <AdminTable
        caption="Videos"
        columns={VIDEO_COLUMNS}
        rows={[LIVE_VIDEO, DISABLED_VIDEO]}
      />,
    );
    const stacked = within(view.container).getByRole("list", {
      name: "Videos",
    });
    const [live, disabled] = within(stacked).getAllByRole("listitem");
    const labels = (item: HTMLElement) =>
      [...item.querySelectorAll("dt")].map((dt) => dt.textContent);
    expect(labels(live)).not.toContain("Reason");
    expect(labels(disabled)).toContain("Reason");
    expect(
      within(live).getByRole("button", { name: "Disable First snow" }),
    ).toBeTruthy();
    expect(
      within(disabled).getByRole("button", {
        name: "Enable Rooftop storm timelapse",
      }),
    ).toBeTruthy();
  });

  it("Requests: «Exclusive» or nothing, the money in its currency, the ids, the raw reason, auto-approve, the deadline only while waiting", () => {
    const { headers, rows, cells } = table(
      <AdminTable
        caption="Requests"
        columns={REQUEST_COLUMNS}
        rows={[
          WAITING_REQUEST,
          { ...WAITING_REQUEST, id: "r-claimed", claimed: true },
          DECLINED_REQUEST,
        ]}
        nowrap
      />,
      "Requests",
    );
    expect(headers).toEqual([
      "Licensee",
      "Buyer email",
      "Video",
      "Scope",
      "Type",
      "License",
      "Fee",
      "Total",
      "Checkout",
      "PaymentIntent",
      "Charge",
      "Status",
      "Reason",
      "Auto-approve",
      "Deadline",
      "Created",
    ]);
    const deadline = formatDeadline(
      new Date(WAITING_REQUEST.expiresAt ?? ""),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    const ids = [
      "cs_test_a1B2c3D4e5F6g7H8",
      "pi_3QfKx2eZvKYlo2C0",
      "ch_3QfKx2eZvKYlo2C0",
    ];
    expect(rows[0]).toEqual([
      "Daily Laughs Media LLC",
      "ana@studio.com",
      "First snow",
      "Paid social ads · 1 year · Worldwide",
      "Exclusive",
      "CA$1,575.00",
      "CA$157.50",
      "CA$1,732.50",
      ...ids,
      "awaiting_approval",
      "—",
      "on",
      deadline,
      CREATED_TEXT,
    ]);
    expect(rows[1][11]).toBe("Processing…");
    expect(rows[1][14]).toBe(deadline);
    expect(rows[2]).toEqual([
      "Morning Show Inc.",
      "ana@studio.com",
      "First snow",
      "Paid social ads · 1 year · Worldwide",
      "",
      "CA$1,575.00",
      "CA$157.50",
      "CA$1,732.50",
      ids[0],
      ids[1],
      "—",
      "Declined",
      "video_disabled",
      "on · fell back",
      "—",
      CREATED_TEXT,
    ]);
    // An id is cut in the table only, whole in the page and its tooltip.
    const checkout = cells[0][8].querySelector("[title]");
    expect(checkout?.getAttribute("title")).toBe(ids[0]);
    expect(checkout?.className).toContain("lg:truncate");
    expect(cells[0][7].className).toContain("tabular-nums");
    expect(cells[0][14].querySelector("time")?.getAttribute("dateTime")).toBe(
      WAITING_REQUEST.expiresAt,
    );
  });

  it("Licenses: the computed status, «Exclusive» or Standard, the money (a failed one in danger text, with Retry), Revoke while not revoked", () => {
    const { headers, rows, cells } = table(
      <AdminTable
        caption="Licenses"
        columns={LICENSE_COLUMNS}
        rows={[
          VALID_LICENSE,
          FAILED_TRANSFER_LICENSE,
          REFUNDED_LICENSE,
          FAILED_RETURNS_LICENSE,
          {
            ...VALID_LICENSE,
            id: "l-revoked",
            status: "revoked",
            transfer: null,
            revokedAt: VALID_LICENSE.issuedAt,
            revokedReason: "payment_reversed",
          },
          { ...VALID_LICENSE, id: "l-none", transfer: null },
        ]}
      />,
      "Licenses",
    );
    expect(headers).toEqual([
      "Code",
      "Licensed to",
      "Video",
      "Status",
      "Type",
      "Issued",
      "Downloads",
      "Money",
      "Revoked",
      "Action",
    ]);
    const row = (
      code: string,
      status: string,
      type: string,
      downloads: string,
      money: string,
      revoked: string,
      action: string,
    ) => [
      code,
      "Daily Laughs Media LLC",
      "First snow",
      status,
      type,
      CREATED_TEXT,
      downloads,
      money,
      revoked,
      action,
    ];
    expect(rows).toEqual([
      row(
        "CL-7K3M-9QXA",
        "Valid",
        "Exclusive",
        "2",
        "Transfer CA$1,575.00 sent",
        "—",
        "Revoke",
      ),
      row(
        "CL-9P2D-6HNC",
        "Valid",
        "Standard",
        "0",
        "Transfer failed (account_closed)Retry",
        "—",
        "Revoke",
      ),
      row(
        "CL-4F8T-2WRB",
        "Revoked",
        "Exclusive",
        "2",
        "Refunded CA$1,732.50 · Taken back CA$1,575.00",
        CREATED_TEXT,
        "",
      ),
      row(
        "CL-2B7Q-K9WD",
        "Revoked",
        "Exclusive",
        "2",
        "Refund failedRetry · Take-back failedRetry",
        CREATED_TEXT,
        "",
      ),
      row(
        "CL-7K3M-9QXA",
        "Revoked",
        "Exclusive",
        "2",
        "No refund (money already returned) · Nothing to take back",
        CREATED_TEXT,
        "",
      ),
      row("CL-7K3M-9QXA", "Valid", "Exclusive", "2", "—", "—", "Revoke"),
    ]);
    const money = (r: number) => cells[r]?.[7] as HTMLElement;
    expect(money(1).querySelector(".text-danger-text")).not.toBeNull();
    expect(money(3).querySelector(".text-danger-text")).not.toBeNull();
    for (const r of [0, 2, 4]) {
      expect(money(r).querySelector(".text-danger-text")).toBeNull();
    }
    // Each failed part has its own Retry, named by its kind and the license (Q-211); nothing else has one.
    const retries = (r: number) =>
      within(money(r))
        .queryAllByRole("button")
        .map((b) => [b.getAttribute("aria-label"), b.textContent]);
    expect(retries(1)).toEqual([["Retry transfer for CL-9P2D-6HNC", "Retry"]]);
    expect(retries(3)).toEqual([
      ["Retry refund for CL-2B7Q-K9WD", "Retry"],
      ["Retry take-back for CL-2B7Q-K9WD", "Retry"],
    ]);
    for (const r of [0, 2, 4, 5]) expect(retries(r)).toEqual([]);
    // Revoke, named by the code, only while not revoked.
    const revoke = (r: number) => within(cells[r]?.[9] as HTMLElement);
    expect(
      revoke(0).getByRole("button", { name: "Revoke CL-7K3M-9QXA" })
        .textContent,
    ).toBe("Revoke");
    expect(revoke(2).queryByRole("button")).toBeNull();
  });

  it("Licenses, stacked: the money under its label, the Retry in it, Revoke last; a revoked row has no actions line", () => {
    const view = render(
      <AdminTable
        caption="Licenses"
        columns={LICENSE_COLUMNS}
        rows={[FAILED_TRANSFER_LICENSE, REFUNDED_LICENSE]}
      />,
    );
    const [open, revoked] = within(
      within(view.container).getByRole("list", { name: "Licenses" }),
    ).getAllByRole("listitem");
    const moneyOf = (item: HTMLElement) =>
      [...item.querySelectorAll("dt")].find((dt) => dt.textContent === "Money")
        ?.nextElementSibling;
    expect(moneyOf(open as HTMLElement)?.textContent).toBe(
      "Transfer failed (account_closed)Retry",
    );
    expect(moneyOf(revoked as HTMLElement)?.textContent).toBe(
      "Refunded CA$1,732.50 · Taken back CA$1,575.00",
    );
    const lastLine = (item: HTMLElement) => item.lastElementChild;
    expect(lastLine(open as HTMLElement)?.textContent).toBe("Revoke");
    expect(lastLine(revoked as HTMLElement)?.tagName).toBe("DL");
  });

  it("an empty tab shows “Nothing here yet.” in place of its table", () => {
    const view = render(
      <AdminTable caption="Creators" columns={CREATOR_COLUMNS} rows={[]} />,
    );
    expect(view.container.querySelector("table")).toBeNull();
    expect(view.container.textContent).toBe("Nothing here yet.");
  });
});

describe("the Events lists (design §4.9, §6.7)", () => {
  it("heads each list, and shows an empty one's line in its place", () => {
    const view = render(<EventsLists events={EVENTS} />);
    const headings = within(view.container)
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual([
      "Latest events",
      "Failed money movements",
      "Failed emails",
      "Unprocessed Stripe events",
    ]);
    expect(
      within(view.container)
        .getAllByRole("table")
        .map((t) => t.querySelector("caption")?.textContent),
    ).toEqual(["Latest events", "Failed money movements", "Failed emails"]);
    const stripe = within(view.container)
      .getByRole("heading", { name: "Unprocessed Stripe events" })
      .closest("section") as HTMLElement;
    expect(stripe.textContent).toBe(
      "Unprocessed Stripe eventsNothing here yet.",
    );
  });

  it("prints each audit row's action verbatim, its actor, target and details, a flagged one in danger text with its cue", () => {
    const { headers, rows, wide } = table(
      <EventsLists events={EVENTS} />,
      "Latest events",
    );
    expect(headers).toEqual(["Time", "Action", "Actor", "Target", "Details"]);
    expect(rows).toEqual([
      [
        CREATED_TEXT,
        "video.enabled",
        "admin · owner@example.com",
        `video ${AUDIT_ROW.entityId}`,
        '{"previousReason":"other"}',
      ],
      [
        `Flagged. ${CREATED_TEXT}`,
        "license_request.exclusive_conflict",
        "system · auto_approve",
        `license_request ${FLAGGED_AUDIT_ROW.entityId}`,
        '{"exclusive":true}',
      ],
    ]);
    const [plain, flagged] = within(wide).getAllByRole("row").slice(1);
    expect(flagged.getAttribute("data-tone")).toBe("danger");
    expect(plain.getAttribute("data-tone")).toBeNull();
    // The time is ink-2, which a flagged row's danger text overrides through the row's group.
    expect(flagged.className).toContain("group/row");
    const time = (row: Element) =>
      row.querySelector("td span.tabular-nums")?.className ?? "";
    expect(time(flagged)).toContain(
      "group-data-[tone=danger]/row:text-danger-text",
    );
    expect(time(plain)).toContain("text-ink-2");
  });

  it("lists failed money movements by kind, license, amount, attempt, error and time, each with its Retry (Q-209)", () => {
    const { headers, rows, cells } = table(
      <EventsLists
        events={{
          ...EVENTS,
          failedMovements: [
            FAILED_MOVEMENT,
            {
              ...FAILED_MOVEMENT,
              id: "f0000000-0000-4000-8000-000000000004",
              kind: "buyer_refund",
              amountCents: 173250,
              attempt: 1,
              lastError: null,
            },
            {
              ...FAILED_MOVEMENT,
              id: "t0000000-0000-4000-8000-000000000002",
              kind: "creator_transfer",
              licenseCode: "CL-9P2D-6HNC",
              amountCents: 90000,
              currency: "usd",
              lastError: "account_closed",
            },
          ],
        }}
      />,
      "Failed money movements",
    );
    expect(headers).toEqual([
      "Kind",
      "License",
      "Amount",
      "Attempt",
      "Error",
      "Updated",
      "Retry",
    ]);
    expect(rows).toEqual([
      [
        "Take-back",
        "CL-2B7Q-K9WD",
        "CA$1,575.00",
        "2",
        "insufficient_funds",
        CREATED_TEXT,
        "Retry",
      ],
      [
        "Refund",
        "CL-2B7Q-K9WD",
        "CA$1,732.50",
        "1",
        "—",
        CREATED_TEXT,
        "Retry",
      ],
      [
        "Transfer",
        "CL-9P2D-6HNC",
        "US$900.00",
        "2",
        "account_closed",
        CREATED_TEXT,
        "Retry",
      ],
    ]);
    expect(
      cells.map((r) =>
        within(r[6] as HTMLElement)
          .getByRole("button")
          .getAttribute("aria-label"),
      ),
    ).toEqual([
      "Retry take-back for CL-2B7Q-K9WD",
      "Retry refund for CL-2B7Q-K9WD",
      "Retry transfer for CL-9P2D-6HNC",
    ]);
    expect(cells[0]?.[2]?.className).toContain("tabular-nums");
  });

  it("lists failed emails without their recipient, and unprocessed Stripe events with their currency", () => {
    const emails = table(<EventsLists events={EVENTS} />, "Failed emails");
    expect(emails.headers).toEqual([
      "Time",
      "Template",
      "Entity",
      "Attempts",
      "Error",
    ]);
    expect(emails.rows).toEqual([
      [
        CREATED_TEXT,
        "request-declined",
        `license_request ${WAITING_REQUEST.id}`,
        "3",
        "SmtpError",
      ],
    ]);
    cleanup();
    const stripe = table(
      <EventsLists events={{ ...EVENTS, stripeEvents: [STRIPE_EVENT] }} />,
      "Unprocessed Stripe events",
    );
    expect(stripe.headers).toEqual([
      "Received",
      "Id",
      "Type",
      "Currency",
      "Account",
      "Attempts",
      "Last error",
    ]);
    expect(stripe.rows).toEqual([
      [
        CREATED_TEXT,
        STRIPE_EVENT.id,
        "payment_intent.amount_capturable_updated",
        "CAD",
        "—",
        "1",
        "timeout",
      ],
    ]);
  });
});
