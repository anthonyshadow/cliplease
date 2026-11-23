// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/toast";
import type { AdminEvents, AdminLicenseRow } from "@/server/admin/queries";
import {
  EVENTS,
  FAILED_MOVEMENT,
  FAILED_RETURNS_LICENSE,
  FAILED_TRANSFER_LICENSE,
  VALID_LICENSE,
} from "../../../../tests/helpers/admin-fixtures";
import {
  answered,
  holdAnswer,
  noSheet,
  press,
  sheet,
} from "../../../../tests/helpers/sheet-dom";
import { AdminTable } from "./admin-cells";
import { EventsLists } from "./events-lists";
import { focusAnchorSelector } from "./focus-anchor";
import { LICENSE_COLUMNS } from "./licenses-table";

// What a row keeps when the action's refresh() re-renders it (a Revoke or a Retry): the Retry sheet stays open across
// a new failure code, and once the row's action is gone the focus lands on the row's code (Licenses) or the list's
// heading (an Events row that left its list), never on <body>.

const mocks = vi.hoisted(() => ({
  adminRevokeLicense: vi.fn(),
  adminRetryMoneyMovement: vi.fn(),
}));
vi.mock("@/app/admin/actions", () => ({
  adminDisableVideo: vi.fn(),
  adminEnableVideo: vi.fn(),
  adminRevokeLicense: mocks.adminRevokeLicense,
  adminRetryMoneyMovement: mocks.adminRetryMoneyMovement,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Licenses({ rows }: { rows: AdminLicenseRow[] }) {
  return (
    <>
      <AdminTable caption="Licenses" columns={LICENSE_COLUMNS} rows={rows} />
      <Toaster />
    </>
  );
}

function Events({ events }: { events: AdminEvents }) {
  return (
    <>
      <EventsLists events={events} />
      <Toaster />
    </>
  );
}

type Form = "stacked" | "wide";

/** One form of the table (jsdom lays nothing out, so both are there): the stacked rows or the lg table. */
const formOf = (container: HTMLElement, form: Form) =>
  container.querySelector(
    form === "stacked" ? "[data-table-stacked]" : "[data-table-wide]",
  ) as HTMLElement;

/** A button in `scope` by its name; while a sheet is open the page behind it is hidden, so `hidden` finds it there. */
const button = (scope: HTMLElement, name: string) =>
  within(scope).getByRole("button", { name, hidden: true });

/** The row's code in `scope`: where the focus lands once its action is gone. */
const codeOf = (scope: HTMLElement) =>
  scope.querySelector(focusAnchorSelector("row")) as HTMLElement;

/** VALID_LICENSE as the refresh after its revoke reads it: revoked, its refund and take-back pending. */
const REVOKED: AdminLicenseRow = {
  ...VALID_LICENSE,
  status: "revoked",
  revokedAt: VALID_LICENSE.issuedAt,
  revokedReason: "issued_in_error",
  refund: {
    id: "f0000000-0000-4000-8000-000000000001",
    status: "pending",
    amountCents: VALID_LICENSE.amountTotalCents,
    lastError: null,
  },
  reversal: {
    id: "b0000000-0000-4000-8000-000000000001",
    status: "pending",
    amountCents: VALID_LICENSE.licensePriceCents,
    lastError: null,
  },
};

describe("a Licenses row refreshed under its Retry sheet", () => {
  it("keeps the sheet open, with the new failure's Banner, when the refreshed row reads a new code", async () => {
    mocks.adminRetryMoneyMovement.mockResolvedValueOnce(
      answered({ outcome: "failed", code: "insufficient_funds" }),
    );
    const { container, rerender } = render(
      <Licenses rows={[FAILED_TRANSFER_LICENSE]} />,
    );
    const wide = formOf(container, "wide");
    fireEvent.click(button(wide, "Retry transfer for CL-9P2D-6HNC"));
    await press("Retry");
    // The action's refresh(): the transfer failed again, with another code.
    const transfer = FAILED_TRANSFER_LICENSE.transfer;
    if (!transfer) throw new Error("the fixture has a transfer");
    rerender(
      <Licenses
        rows={[
          {
            ...FAILED_TRANSFER_LICENSE,
            transfer: { ...transfer, lastError: "insufficient_funds" },
          },
        ]}
      />,
    );
    expect(wide.textContent).toContain("Transfer failed (insufficient_funds)");
    expect(within(sheet()).getByRole("alert").textContent).toBe(
      "That didn't work (insufficient_funds). Try again later.",
    );
  });
});

describe("the focus once a row's action is gone", () => {
  it.each<Form>(["stacked", "wide"])(
    "a revoke that worked (%s): the sheet closes onto Revoke, then the refreshed row drops it and the focus lands on the code",
    async (form) => {
      mocks.adminRevokeLicense.mockResolvedValueOnce(
        answered({ outcome: "revoked" }),
      );
      const { container, rerender } = render(
        <Licenses rows={[VALID_LICENSE]} />,
      );
      const rows = formOf(container, form);
      const revoke = button(rows, "Revoke CL-7K3M-9QXA");
      fireEvent.click(revoke);
      fireEvent.change(
        within(sheet()).getByRole("combobox", { name: "Reason" }),
        { target: { value: "issued_in_error" } },
      );
      await press("Revoke and refund");
      await waitFor(() => expect(noSheet()).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(revoke));

      rerender(<Licenses rows={[REVOKED]} />);
      expect(revoke.isConnected).toBe(false);
      await waitFor(() => expect(document.activeElement).toBe(codeOf(rows)));
      expect(document.activeElement?.textContent).toBe("CL-7K3M-9QXA");
      expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
    },
  );

  it("a revoke whose refresh lands while its sheet is still open: the focus lands on the code, not <body>", async () => {
    const answer = holdAnswer(mocks.adminRevokeLicense);
    const { container, rerender } = render(<Licenses rows={[VALID_LICENSE]} />);
    const wide = formOf(container, "wide");
    fireEvent.click(button(wide, "Revoke CL-7K3M-9QXA"));
    fireEvent.change(
      within(sheet()).getByRole("combobox", { name: "Reason" }),
      { target: { value: "rights_claim" } },
    );
    await press("Revoke and refund");

    rerender(<Licenses rows={[REVOKED]} />);
    await answer(answered({ outcome: "revoked" }));
    await waitFor(() => expect(noSheet()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(codeOf(wide)));
  });

  it("a Retry that worked takes its Retry away from the Money cell: the focus lands on the row's code", async () => {
    mocks.adminRetryMoneyMovement.mockResolvedValueOnce(
      answered({ outcome: "succeeded" }),
    );
    const { container, rerender } = render(
      <Licenses rows={[FAILED_RETURNS_LICENSE]} />,
    );
    const wide = formOf(container, "wide");
    const retry = button(wide, "Retry refund for CL-2B7Q-K9WD");
    fireEvent.click(retry);
    await press("Retry");
    await waitFor(() => expect(noSheet()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(retry));

    const { refund } = FAILED_RETURNS_LICENSE;
    if (!refund) throw new Error("the fixture has a refund");
    rerender(
      <Licenses
        rows={[
          {
            ...FAILED_RETURNS_LICENSE,
            refund: { ...refund, status: "succeeded", lastError: null },
          },
        ]}
      />,
    );
    expect(retry.isConnected).toBe(false);
    // The take-back's Retry is still there: only the refund's left.
    expect(button(wide, "Retry take-back for CL-2B7Q-K9WD")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(codeOf(wide)));
  });

  it.each<Form>(["stacked", "wide"])(
    "a Retry that worked takes its row out of Events' failed movements (%s): the focus lands on the list's heading",
    async (form) => {
      mocks.adminRetryMoneyMovement.mockResolvedValueOnce(
        answered({ outcome: "succeeded" }),
      );
      const events = { ...EVENTS, failedMovements: [FAILED_MOVEMENT] };
      const { container, rerender } = render(<Events events={events} />);
      const heading = screen.getByRole("heading", {
        name: "Failed money movements",
      });
      const list = heading.closest("section") as HTMLElement;
      const retry = button(
        formOf(list, form),
        "Retry take-back for CL-2B7Q-K9WD",
      );
      fireEvent.click(retry);
      await press("Retry");
      await waitFor(() => expect(noSheet()).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(retry));

      rerender(<Events events={{ ...events, failedMovements: [] }} />);
      expect(retry.isConnected).toBe(false);
      expect(list.textContent).toBe("Failed money movementsNothing here yet.");
      await waitFor(() => expect(document.activeElement).toBe(heading));
      expect(container.contains(heading)).toBe(true);
    },
  );
});
