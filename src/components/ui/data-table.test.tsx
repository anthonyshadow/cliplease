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
