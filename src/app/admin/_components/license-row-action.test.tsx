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
import type { AdminRevokeOutcome } from "@/app/admin/actions";
import { Toaster } from "@/components/ui/toast";
import { DISABLE_COPY } from "@/lib/admin/copy";
import { GENERIC_ERROR_MESSAGE } from "@/lib/result";
import {
  licenseAction,
  VALID_LICENSE,
} from "../../../../tests/helpers/admin-fixtures";
import {
  answered,
  footer,
  holdAnswer,
  inSheet,
  latestToast,
  noSheet,
  press,
  sheet,
  toastCount,
} from "../../../../tests/helpers/sheet-dom";
import {
  type AdminLicenseAction,
  LicenseRowAction,
} from "./license-row-action";

const mocks = vi.hoisted(() => ({ adminRevokeLicense: vi.fn() }));
vi.mock("@/app/admin/actions", () => ({
  adminRevokeLicense: mocks.adminRevokeLicense,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const CODE = VALID_LICENSE.code;
/** VALID_LICENSE's money (07 D99): the buyer's total and the creator's share. */
const TAKE_BACK =
  "This refunds the buyer CA$1,732.50 and takes back CA$1,575.00 from @maya.";
const CANCEL_PAYOUT =
  "This refunds the buyer CA$1,732.50 and cancels the CA$1,575.00 payout to @maya.";
const REFUND_ONLY = "This refunds the buyer CA$1,732.50.";
const NO_REFUND = "No refund: the money already went back.";

function Row({ row = licenseAction() }: { row?: AdminLicenseAction }) {
  return (
    <>
      <LicenseRowAction license={row} />
      <Toaster />
    </>
  );
}

const trigger = () => screen.getByRole("button", { name: `Revoke ${CODE}` });
const reasonField = () =>
  inSheet().getByRole<HTMLSelectElement>("combobox", { name: "Reason" });
const noteField = () =>
  inSheet().getByRole<HTMLTextAreaElement>("textbox", {
    name: "Note (optional)",
  });
/** The sheet's accessible description: its money sentence. */
const description = () =>
  document.getElementById(sheet().getAttribute("aria-describedby") ?? "")
    ?.textContent;

function openRevoke() {
  fireEvent.click(trigger());
  return sheet();
}

function choose(reason: string) {
  fireEvent.change(reasonField(), { target: { value: reason } });
}

/** Revoke's answer: revoked, already revoked by another admin, or refused while the payout is in flight (Q-207). */
const revoked = (outcome: AdminRevokeOutcome["outcome"] = "revoked") =>
  answered({ outcome });

describe("LicenseRowAction (05 §7 callout 5)", () => {
  it("offers Revoke, a secondary button named by the code, with no sheet until it is pressed", () => {
    render(<Row />);
    expect(trigger().textContent).toBe("Revoke");
    expect(trigger().getAttribute("data-variant")).toBe("secondary");
    expect(noSheet()).toBeNull();
  });
});

describe("The Revoke sheet (05 §7 callout 10; 04 §9.22, §11.10; 07 D86; owner answers Q-207, Q-209)", () => {
  it("asks with the money sentence, a reason to choose and the optional note; Keep license takes the first focus", () => {
    render(<Row />);
    const dialog = openRevoke();
    expect(
      within(dialog).getByRole("heading", { name: `Revoke ${CODE}?` }),
    ).toBeTruthy();
    expect(description()).toBe(TAKE_BACK);
    expect(
      [...reasonField().options].map((o) => [o.value, o.textContent]),
    ).toEqual([
      ["", "Choose a reason"],
      ["rights_claim", "Rights claim"],
      ["licensee_breach", "Licensee breach"],
      ["payment_reversed", "Payment reversed"],
      ["issued_in_error", "Issued in error"],
    ]);
    expect(reasonField().value).toBe("");
    expect(reasonField().required).toBe(true);
    expect(noteField().maxLength).toBe(200);
    expect(dialog.textContent).toContain(DISABLE_COPY.noteHelper);
    expect(footer()).toEqual([
      ["Revoke and refund", "destructive"],
      ["Keep license", "secondary"],
    ]);
    expect(document.activeElement?.textContent).toBe("Keep license");
  });

  it.each([
    ["succeeded", TAKE_BACK],
    ["pending", CANCEL_PAYOUT],
    ["failed", CANCEL_PAYOUT],
    ["canceled", REFUND_ONLY],
    [null, REFUND_ONLY],
  ] as const)(
    "with the creator transfer %s, says what the revoke does with it",
    (transferStatus, body) => {
      render(<Row row={licenseAction(transferStatus)} />);
      openRevoke();
      expect(description()).toBe(body);
    },
  );

  it("switches live to Payment reversed's sentence and its Revoke, and back", () => {
    render(<Row />);
    openRevoke();
    choose("payment_reversed");
    expect(description()).toBe(NO_REFUND);
    expect(footer()[0]).toEqual(["Revoke", "destructive"]);
    choose("issued_in_error");
    expect(description()).toBe(TAKE_BACK);
    expect(footer()[0]).toEqual(["Revoke and refund", "destructive"]);
  });

  it("refuses without a reason: the field's error, the focus on it, and no call", async () => {
    render(<Row />);
    openRevoke();
    await press("Revoke and refund");
    expect(mocks.adminRevokeLicense).not.toHaveBeenCalled();
    expect(reasonField().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(reasonField());
    const errorId = reasonField()
      .getAttribute("aria-describedby")
      ?.split(" ")[0];
    expect(document.getElementById(errorId ?? "")?.textContent).toBe(
      "Choose a reason.",
    );
    choose("rights_claim");
    expect(reasonField().getAttribute("aria-invalid")).toBeNull();
  });

  it("shows the server's error on the reason when it refuses one", async () => {
    mocks.adminRevokeLicense.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "invalid_input",
        message: "Choose a reason.",
        fields: { reason: ["Choose a reason."] },
      },
    });
    render(<Row />);
    openRevoke();
    choose("licensee_breach");
    await press("Revoke and refund");
    expect(reasonField().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(reasonField());
    expect(inSheet().queryByRole("alert")).toBeNull();
  });

  it("revokes with the reason and note, can't be closed while “Revoking…”, then closes with the toast and the focus on Revoke", async () => {
    const answer = holdAnswer(mocks.adminRevokeLicense);
    render(<Row />);
    openRevoke();
    choose("issued_in_error");
    fireEvent.change(noteField(), { target: { value: "ticket-77" } });
    const confirm = inSheet().getByRole("button", {
      name: "Revoke and refund",
    });
    await press("Revoke and refund");
    expect(mocks.adminRevokeLicense).toHaveBeenCalledExactlyOnceWith({
      licenseId: VALID_LICENSE.id,
      reason: "issued_in_error",
      note: "ticket-77",
    });
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect(
      [...confirm.querySelectorAll('[aria-hidden="false"]')].some(
        (el) => el.textContent === "Revoking…",
      ),
    ).toBe(true);
    fireEvent.click(confirm);
    expect(mocks.adminRevokeLicense).toHaveBeenCalledTimes(1);
    fireEvent.click(inSheet().getByRole("button", { name: "Keep license" }));
    fireEvent.click(inSheet().getByRole("button", { name: "Close" }));
    fireEvent.keyDown(sheet(), { key: "Escape" });
    expect(sheet()).toBeTruthy();
    await answer(revoked());
    await waitFor(() => expect(noSheet()).toBeNull());
    expect(latestToast()?.textContent).toBe("License revoked.");
    expect(document.activeElement).toBe(trigger());
  });

  it("revokes Payment reversed with its Revoke", async () => {
    mocks.adminRevokeLicense.mockResolvedValueOnce(revoked());
    render(<Row />);
    openRevoke();
    choose("payment_reversed");
    await press("Revoke");
    expect(mocks.adminRevokeLicense).toHaveBeenCalledExactlyOnceWith({
      licenseId: VALID_LICENSE.id,
      reason: "payment_reversed",
      note: "",
    });
    await waitFor(() => expect(noSheet()).toBeNull());
  });

  it("closes with no toast when another admin revoked it first: the refreshed row shows the truth", async () => {
    mocks.adminRevokeLicense.mockResolvedValueOnce(revoked("already_revoked"));
    render(<Row />);
    openRevoke();
    choose("rights_claim");
    const toasts = toastCount();
    await press("Revoke and refund");
    await waitFor(() => expect(noSheet()).toBeNull());
    expect(toastCount()).toBe(toasts);
  });

  it("refuses while the creator's payout is in flight with Q-207's sentence, keeping everything (owner answer Q-207)", async () => {
    mocks.adminRevokeLicense.mockResolvedValueOnce(
      revoked("transfer_in_progress"),
    );
    render(<Row />);
    openRevoke();
    choose("rights_claim");
    fireEvent.change(noteField(), { target: { value: "claim-9" } });
    await press("Revoke and refund");
    expect(inSheet().getByRole("alert").textContent).toBe(
      "A payout to @maya is in progress. Try again in a minute.",
    );
    expect(reasonField().value).toBe("rights_claim");
    expect(noteField().value).toBe("claim-9");
    expect(footer()[0]).toEqual(["Revoke and refund", "destructive"]);
  });

  it.each([
    [
      "an error answer",
      () =>
        mocks.adminRevokeLicense.mockResolvedValueOnce({
          ok: false,
          error: { code: "not_found", message: GENERIC_ERROR_MESSAGE },
        }),
    ],
    [
      "a failed call (offline, a timeout)",
      () =>
        mocks.adminRevokeLicense.mockRejectedValueOnce(new Error("offline")),
    ],
  ])("shows the error Banner on %s", async (_, arrange) => {
    arrange();
    render(<Row />);
    openRevoke();
    choose("rights_claim");
    await press("Revoke and refund");
    expect(inSheet().getByRole("alert").textContent).toBe(
      GENERIC_ERROR_MESSAGE,
    );
  });

  it("starts afresh each time it opens", () => {
    render(<Row />);
    openRevoke();
    choose("payment_reversed");
    fireEvent.change(noteField(), { target: { value: "draft note" } });
    fireEvent.click(inSheet().getByRole("button", { name: "Keep license" }));
    openRevoke();
    expect(reasonField().value).toBe("");
    expect(noteField().value).toBe("");
    expect(description()).toBe(TAKE_BACK);
  });
});
