// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type DataColumn, DataTable } from "./data-table";

afterEach(cleanup);

type Row = { code: string; licensee: string; note: string | null };

const ROWS: Row[] = [
  { code: "CL-7K3M-9QXA", licensee: "Daily Laughs Media LLC", note: "Paid" },
  { code: "CL-4F8T-2WRB", licensee: "Morning Show Network", note: null },
];

const COLUMNS: DataColumn<Row>[] = [
  { header: "Code", cell: (row) => row.code },
  { header: "Licensed to", cell: (row) => row.licensee },
  { header: "Note", cell: (row) => row.note },
  { header: "Total", cell: () => "CA$1,575.00", numeric: true },
  {
    header: "Public record",
    action: true,
    cell: (row) => <a href={`/verify/${row.code}`}>View public record</a>,
  },
];

function renderTable() {
  const { container } = render(
    <DataTable
      caption="Licenses"
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(row) => row.code}
    />,
  );
  return {
    stacked: container.querySelector("[data-table-stacked]") as HTMLElement,
    wide: container.querySelector("[data-table-wide]") as HTMLElement,
  };
}

describe("DataTable (04 §9.31; 07 D144, D146)", () => {
  it("renders both forms, each shown at its tiers by CSS alone: stacked below lg, the table from lg", () => {
    const { stacked, wide } = renderTable();
    expect(stacked.className).toContain("lg:hidden");
    expect(wide.className).toContain("hidden");
    expect(wide.className).toContain("lg:block");
    expect(wide.className).toContain("overflow-x-auto");
    // The scroll wrapper is positioned, so sr-only text past its edge scrolls with it instead of widening the page.
    expect(wide.className).toContain("relative");
    expect(stacked.getAttribute("aria-label")).toBe("Licenses");
    expect(within(wide).getByRole("table").textContent).toContain("Licenses");
  });

  it("stacks each row's labels above their values, the row actions last and unlabeled", () => {
    const { stacked } = renderTable();
    const [first] = within(stacked).getAllByRole("listitem");
    const labels = [...first.querySelectorAll("dt")].map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.tagName,
      dt.nextElementSibling?.textContent,
    ]);
    expect(labels).toEqual([
      ["Code", "DD", "CL-7K3M-9QXA"],
      ["Licensed to", "DD", "Daily Laughs Media LLC"],
      ["Note", "DD", "Paid"],
      ["Total", "DD", "CA$1,575.00"],
    ]);
    const link = within(first).getByRole("link", {
      name: "View public record",
    });
    expect(first.lastElementChild?.contains(link)).toBe(true);
    expect(first.querySelector("dl")?.contains(link)).toBe(false);
  });

  it("leaves a stacked row's label out when its cell has nothing to show; the table keeps the cell empty", () => {
    const { stacked, wide } = renderTable();
    const second = within(stacked).getAllByRole("listitem")[1];
    expect(
      [...second.querySelectorAll("dt")].map((dt) => dt.textContent),
    ).toEqual(["Code", "Licensed to", "Total"]);
    const cells = within(wide).getAllByRole("row")[2].querySelectorAll("td");
    expect([...cells].map((td) => td.textContent)).toEqual([
      "CL-4F8T-2WRB",
      "Morning Show Network",
      "",
      "CA$1,575.00",
      "View public record",
    ]);
  });

  it("gives the table every header, an action's for screen readers only, and right-aligns numbers", () => {
    const { wide } = renderTable();
    const headers = within(wide).getAllByRole("columnheader");
    expect(headers.map((th) => th.textContent)).toEqual([
      "Code",
      "Licensed to",
      "Note",
      "Total",
      "Public record",
    ]);
    expect(headers[4].querySelector(".sr-only")?.textContent).toBe(
      "Public record",
    );
    expect(headers[3].className).toContain("text-right");
    const total = within(wide).getAllByRole("cell")[3];
    expect(total.className).toContain("tabular-nums");
  });
});

describe("DataTable's options (design/P21-admin-view.md §4.9, §4.11, §6)", () => {
  type Event = { id: string; time: string; action: string; flagged: boolean };
  const EVENTS: Event[] = [
    { id: "1", time: "12:41", action: "video.enabled", flagged: false },
    {
      id: "2",
      time: "12:39",
      action: "license_request.exclusive_conflict",
      flagged: true,
    },
  ];
  const EVENT_COLUMNS: DataColumn<Event>[] = [
    { header: "Time", cell: (e) => e.time },
    { header: "Action", cell: (e) => e.action },
    {
      header: "Open",
      action: true,
      cell: (e) => <a href={`/e/${e.id}`}>Open {e.id}</a>,
    },
  ];

  function renderEvents() {
    const { container } = render(
      <DataTable
        caption="Latest events"
        columns={EVENT_COLUMNS}
        rows={EVENTS}
        rowKey={(e) => e.id}
        rowFlag={(e) => (e.flagged ? "Flagged" : null)}
      />,
    );
    return {
      stacked: container.querySelector("[data-table-stacked]") as HTMLElement,
      wide: container.querySelector("[data-table-wide]") as HTMLElement,
    };
  }

  it("reads a flagged row in danger text, with a warning icon and its word for screen readers before its first value", () => {
    const { stacked, wide } = renderEvents();
    const [plainRow, flaggedRow] = within(wide).getAllByRole("row").slice(1);
    expect(flaggedRow.getAttribute("data-tone")).toBe("danger");
    expect(plainRow.getAttribute("data-tone")).toBeNull();
    // A cell that colors itself yields to the flag through the row's named group.
    expect(flaggedRow.className).toContain("group/row");
    const [time, action, open] = flaggedRow.querySelectorAll("td");
    expect(time.className).toContain("text-danger-text");
    expect(action.className).toContain("text-danger-text");
    expect(time.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(time.querySelector(".sr-only")?.textContent).toBe("Flagged. ");
    expect(time.textContent).toBe("Flagged. 12:39");
    expect(action.querySelector("svg")).toBeNull();
    expect(open.querySelector("svg")).toBeNull();
    for (const td of plainRow.querySelectorAll("td")) {
      expect(td.className).not.toContain("text-danger-text");
      expect(td.querySelector("svg")).toBeNull();
    }

    const [plainItem, flaggedItem] = within(stacked).getAllByRole("listitem");
    expect(flaggedItem.getAttribute("data-tone")).toBe("danger");
    expect(flaggedItem.className).toContain("group/row");
    const [timeValue, actionValue] = flaggedItem.querySelectorAll("dd");
    expect(timeValue.className).toContain("text-danger-text");
    expect(actionValue.className).toContain("text-danger-text");
    expect(timeValue.querySelector(".sr-only")?.textContent).toBe("Flagged. ");
    expect(timeValue.querySelector("svg")).not.toBeNull();
    for (const dt of flaggedItem.querySelectorAll("dt")) {
      expect(dt.className).not.toContain("text-danger-text");
    }
    expect(plainItem.querySelector("svg")).toBeNull();
    expect(plainItem.querySelector("dd")?.className).not.toContain(
      "text-danger-text",
    );
  });

  it("prints a column's `empty` in a table cell with nothing to show; the stacked row still leaves the label out", () => {
    const { container } = render(
      <DataTable
        caption="Licenses"
        columns={[
          { header: "Code", cell: (row: Row) => row.code },
          { header: "Note", cell: (row: Row) => row.note, empty: "—" },
        ]}
        rows={ROWS}
        rowKey={(row) => row.code}
      />,
    );
    const wide = container.querySelector("[data-table-wide]") as HTMLElement;
    const stacked = container.querySelector(
      "[data-table-stacked]",
    ) as HTMLElement;
    const notes = within(wide)
      .getAllByRole("row")
      .slice(1)
      .map((tr) => tr.querySelectorAll("td")[1].textContent);
    expect(notes).toEqual(["Paid", "—"]);
    const second = within(stacked).getAllByRole("listitem")[1];
    expect(
      [...second.querySelectorAll("dt")].map((dt) => dt.textContent),
    ).toEqual(["Code"]);
  });

  it("sizes the table's columns to their content without wrapping when `nowrap`, and leaves the stacked rows wrapping", () => {
    const { container, rerender } = render(
      <DataTable
        caption="Licenses"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.code}
        nowrap
      />,
    );
    const table = () => container.querySelector("table") as HTMLElement;
    expect(table().className).toContain("w-max");
    expect(table().className).toContain("min-w-full");
    // Set on the table, so every header and cell inherits it.
    expect(table().className).toContain("whitespace-nowrap");
    expect(container.querySelector("dd")?.className).toContain("wrap-anywhere");
    rerender(
      <DataTable
        caption="Licenses"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.code}
      />,
    );
    expect(table().className).not.toContain("w-max");
    expect(table().className).not.toContain("whitespace-nowrap");
  });
});
