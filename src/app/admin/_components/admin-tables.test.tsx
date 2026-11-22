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
  FAILED_TRANSFER_LICENSE,
  FLAGGED_AUDIT_ROW,
  LIVE_VIDEO,
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

  it("Licenses: the computed status, «Exclusive» or Standard, the transfer line (a failed one in danger text)", () => {
    const { headers, rows, cells } = table(
      <AdminTable
        caption="Licenses"
        columns={LICENSE_COLUMNS}
        rows={[
          VALID_LICENSE,
          FAILED_TRANSFER_LICENSE,
          {
            ...VALID_LICENSE,
            id: "l-revoked",
            status: "revoked",
            transfer: null,
            revokedAt: VALID_LICENSE.issuedAt,
          },
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
      "Transfer",
      "Revoked",
    ]);
    expect(rows).toEqual([
      [
        "CL-7K3M-9QXA",
        "Daily Laughs Media LLC",
        "First snow",
        "Valid",
        "Exclusive",
        CREATED_TEXT,
        "2",
        "Transfer CA$1,575.00 sent",
        "—",
      ],
      [
        "CL-9P2D-6HNC",
        "Daily Laughs Media LLC",
        "First snow",
        "Valid",
        "Standard",
        CREATED_TEXT,
        "0",
        "Transfer failed (account_closed)",
        "—",
      ],
      [
        "CL-7K3M-9QXA",
        "Daily Laughs Media LLC",
        "First snow",
        "Revoked",
        "Exclusive",
        CREATED_TEXT,
        "2",
        "—",
        CREATED_TEXT,
      ],
    ]);
    expect(cells[1][7].querySelector(".text-danger-text")).not.toBeNull();
    expect(cells[0][7].querySelector(".text-danger-text")).toBeNull();
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
      "Failed emails",
      "Unprocessed Stripe events",
    ]);
    expect(
      within(view.container)
        .getAllByRole("table")
        .map((t) => t.querySelector("caption")?.textContent),
    ).toEqual(["Latest events", "Failed emails"]);
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
