// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CreatorLicense } from "@/server/licensing/licenses";
import { LicensesTable } from "./licenses-table";

afterEach(cleanup);

const VALID: CreatorLicense = {
  id: "1f0e2d3c-4b5a-4968-8776-5a4b3c2d1e0f",
  code: "CL-7K3M-9QXA",
  status: "valid",
  exclusive: false,
  licenseeName: "Daily Laughs Media LLC",
  title: "First snow",
  scope: "Paid social ads · 1 year · Worldwide",
  issuedAt: "2026-10-15T14:32:00.000Z",
  licensePriceCents: 157500,
  currency: "cad",
  payout: {
    transferStatus: "succeeded",
    transferAmountCents: 157500,
    transferCurrency: "cad",
  },
  downloads: 2,
};

const EXCLUSIVE_EXPIRED: CreatorLicense = {
  ...VALID,
  id: "2a1b0c9d-8e7f-4a6b-9c5d-4e3f2a1b0c9d",
  code: "CL-5RJN-3VDE",
  status: "expired",
  exclusive: true,
  title: "Caught a wave",
  issuedAt: "2025-11-20T15:00:00.000Z",
  licensePriceCents: 472500,
  payout: {
    transferStatus: "pending",
    transferAmountCents: 472500,
    transferCurrency: "cad",
  },
  downloads: 1,
};

const REVOKED: CreatorLicense = {
  ...VALID,
  id: "3b2c1d0e-9f8a-4b7c-8d6e-5f4a3b2c1d0e",
  code: "CL-4F8T-2WRB",
  status: "revoked",
  licenseeName: "Morning Show Network",
  title: "Rooftop storm timelapse",
  scope: "Organic social repost · 30 days · Worldwide",
  issuedAt: "2026-08-31T09:05:00.000Z",
  licensePriceCents: 15000,
  payout: {
    transferStatus: null,
    transferAmountCents: null,
    transferCurrency: null,
  },
  downloads: 0,
};

function renderTable() {
  const { container } = render(
    <LicensesTable licenses={[VALID, EXCLUSIVE_EXPIRED, REVOKED]} />,
  );
  const wide = container.querySelector("[data-table-wide]") as HTMLElement;
  const stacked = container.querySelector(
    "[data-table-stacked]",
  ) as HTMLElement;
  return {
    stacked,
    /** The table's body rows, after its header row. */
    rows: within(wide).getAllByRole("row").slice(1),
  };
}

const cellsOf = (row: HTMLElement) =>
  [...row.querySelectorAll("td")] as HTMLElement[];

describe("LicensesTable (S22; 05 §6.10; owner answer Q-186)", () => {
  it("prints the prompt's columns, the payout line under what the creator got", () => {
    const { rows } = renderTable();
    expect(cellsOf(rows[0]).map((td) => td.textContent)).toEqual([
      "CL-7K3M-9QXA",
      "Daily Laughs Media LLC",
      "First snow",
      "Paid social ads · 1 year · Worldwide",
      "15 Oct 2026",
      "CA$1,575.00Paid out",
      "Valid",
      "Downloaded 2 times",
      "View public record",
    ]);
    expect(within(rows[1]).getByText("Payout pending")).toBeTruthy();
    expect(within(rows[1]).getByText("CA$4,725.00")).toBeTruthy();
  });

  it.each([
    { row: 0, label: "Valid", token: "bg-cleared" },
    { row: 1, label: "Expired", token: "bg-fill" },
    { row: 2, label: "Revoked", token: "bg-danger-tint" },
  ])("shows $label as its status pill", ({ row, label, token }) => {
    const { rows } = renderTable();
    const pill = within(cellsOf(rows[row])[6]).getByText(label);
    expect(pill.className).toContain(token);
  });

  it("puts «Exclusive» beside an exclusive license's status, and on no other row", () => {
    const { rows } = renderTable();
    const status = cellsOf(rows[1])[6];
    const tag = within(status).getByText("Exclusive");
    expect(tag.className).toContain("bg-fill");
    expect(tag.previousElementSibling?.textContent).toBe("Expired");
    for (const row of [rows[0], rows[2]]) {
      expect(within(row).queryByText("Exclusive")).toBeNull();
    }
  });

  it("counts the downloads, in the singular for one and not at all for none", () => {
    const { rows, stacked } = renderTable();
    expect(cellsOf(rows[1])[7].textContent).toBe("Downloaded 1 time");
    expect(cellsOf(rows[2])[7].textContent).toBe("");
    const revoked = within(stacked).getAllByRole("listitem")[2];
    expect(
      [...revoked.querySelectorAll("dt")].map((dt) => dt.textContent),
    ).not.toContain("Downloads");
  });

  it("links each row to its public record, its only link", () => {
    const { rows } = renderTable();
    rows.forEach((row, i) => {
      const links = within(row).getAllByRole("link");
      expect(links).toHaveLength(1);
      expect(links[0].textContent).toBe("View public record");
      expect(links[0].getAttribute("href")).toBe(
        `/verify/${[VALID, EXCLUSIVE_EXPIRED, REVOKED][i].code}`,
      );
    });
  });
});
