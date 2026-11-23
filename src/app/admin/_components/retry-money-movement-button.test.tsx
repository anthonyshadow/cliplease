// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/toast";
import { GENERIC_ERROR_MESSAGE } from "@/lib/result";
import {
  answered,
  footer,
  inSheet,
  label,
  latestToast,
  noSheet,
  press,
  sheet,
} from "../../../../tests/helpers/sheet-dom";
import {
  type RetryableMovement,
  RetryMoneyMovementButton,
} from "./retry-money-movement-button";

const mocks = vi.hoisted(() => ({ adminRetryMoneyMovement: vi.fn() }));
vi.mock("@/app/admin/actions", () => ({
  adminRetryMoneyMovement: mocks.adminRetryMoneyMovement,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MOVEMENT_ID = "00000000-0000-4000-8000-0000000000b4";
const CODE = "CL-2B7Q-K9WD";

const movement = (
  kind: RetryableMovement["kind"] = "transfer_reversal",
  amountCents = 157_500,
): RetryableMovement => ({
  id: MOVEMENT_ID,
  kind,
  amountCents,
  currency: "cad",
  licenseCode: CODE,
  creatorHandle: "maya",
});

function Cell({ m = movement() }: { m?: RetryableMovement }) {
  return (
    <>
      <RetryMoneyMovementButton movement={m} />
      <Toaster />
    </>
  );
}

/** The Retry button: behind the open sheet it is hidden from the accessibility tree, so `hidden` finds it there too. */
const trigger = (name = `Retry take-back for ${CODE}`) =>
  screen.getByRole("button", { name, hidden: true });

const retry = () => press("Retry");

describe("RetryMoneyMovementButton (05 §7 callout 9; owner answers Q-208, Q-211)", () => {
  it.each([
    [
      "buyer_refund",
      173_250,
      `Retry refund for ${CODE}`,
      "Retry this refund?",
      "This tries again to refund the buyer CA$1,732.50.",
    ],
    [
      "transfer_reversal",
      157_500,
      `Retry take-back for ${CODE}`,
      "Retry this take-back?",
      "This tries again to take back CA$1,575.00 from @maya.",
    ],
    [
      "creator_transfer",
      157_500,
      `Retry transfer for ${CODE}`,
      "Retry this transfer?",
      "This tries again to send CA$1,575.00 to @maya.",
    ],
  ] as const)(
    "a %s's Retry reads Retry, is named %s, and asks first",
    (kind, amount, name, title, body) => {
      render(<Cell m={movement(kind, amount)} />);
      const button = trigger(name);
      expect(label(button)).toBe("Retry");
      expect(button.getAttribute("data-variant")).toBe("secondary");
      expect(button.className).toContain("hit-44");
      expect(noSheet()).toBeNull();
      fireEvent.click(button);
      expect(
        screen.getByRole("alertdialog", { name: title, description: body }),
      ).toBe(sheet());
      expect(footer()).toEqual([
        ["Retry", "primary"],
        ["Cancel", "secondary"],
      ]);
      expect(document.activeElement?.textContent).toBe("Cancel");
      expect(mocks.adminRetryMoneyMovement).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["succeeded", "Retry done."],
    ["noop", "Nothing to retry."],
  ] as const)(
    "on %s: the button disabled and the sheet held while “Retrying…”, then closed with “%s” and the focus back",
    async (outcome, words) => {
      let answer: (value: unknown) => void = () => {};
      mocks.adminRetryMoneyMovement.mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
      render(<Cell />);
      fireEvent.click(trigger());
      const confirm = inSheet().getByRole("button", { name: "Retry" });
      await retry();
      expect(mocks.adminRetryMoneyMovement).toHaveBeenCalledExactlyOnceWith({
        movementId: MOVEMENT_ID,
      });
      expect(confirm.getAttribute("aria-busy")).toBe("true");
      expect(
        [...confirm.querySelectorAll('[aria-hidden="false"]')].some(
          (el) => el.textContent === "Retrying…",
        ),
      ).toBe(true);
      expect((trigger() as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(inSheet().getByRole("button", { name: "Cancel" }));
      fireEvent.keyDown(sheet(), { key: "Escape" });
      expect(sheet()).toBeTruthy();
      await act(async () => {
        answer(answered({ outcome }));
      });
      await waitFor(() => expect(noSheet()).toBeNull());
      expect(latestToast()?.textContent).toBe(words);
      expect((trigger() as HTMLButtonElement).disabled).toBe(false);
      expect(document.activeElement).toBe(trigger());
    },
  );

  it.each([
    [
      { outcome: "failed", code: "insufficient_funds" },
      "That didn't work (insufficient_funds). Try again later.",
    ],
    [
      { outcome: "in_progress" },
      "It's already being retried. Try again in a minute.",
    ],
    [{ outcome: "transient" }, "Stripe didn't answer. Try again in a minute."],
  ])("keeps the sheet open on %o with its Banner", async (data, words) => {
    mocks.adminRetryMoneyMovement.mockResolvedValueOnce(answered(data));
    render(<Cell />);
    fireEvent.click(trigger());
    await retry();
    expect(inSheet().getByRole("alert").textContent).toBe(words);
    expect(footer()[0]).toEqual(["Retry", "primary"]);
  });

  it("announces a repeat failure again: each answer is a new Banner", async () => {
    const failed = answered({ outcome: "failed", code: "insufficient_funds" });
    mocks.adminRetryMoneyMovement
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(failed);
    render(<Cell />);
    fireEvent.click(trigger());
    await retry();
    const first = inSheet().getByRole("alert");
    await retry();
    const second = inSheet().getByRole("alert");
    expect(second.textContent).toBe(first.textContent);
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
  });

  it.each([
    [
      "an error answer",
      () =>
        mocks.adminRetryMoneyMovement.mockResolvedValueOnce({
          ok: false,
          error: { code: "not_found", message: GENERIC_ERROR_MESSAGE },
        }),
    ],
    [
      "a failed call (offline, a timeout)",
      () =>
        mocks.adminRetryMoneyMovement.mockRejectedValueOnce(
          new Error("offline"),
        ),
    ],
  ])("shows the error Banner on %s", async (_, arrange) => {
    arrange();
    render(<Cell />);
    fireEvent.click(trigger());
    await retry();
    expect(inSheet().getByRole("alert").textContent).toBe(
      GENERIC_ERROR_MESSAGE,
    );
  });

  it("starts afresh each time it opens", async () => {
    mocks.adminRetryMoneyMovement.mockResolvedValueOnce(
      answered({ outcome: "transient" }),
    );
    render(<Cell />);
    fireEvent.click(trigger());
    await retry();
    expect(inSheet().queryByRole("alert")).not.toBeNull();
    fireEvent.click(inSheet().getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(noSheet()).toBeNull());
    fireEvent.click(trigger());
    expect(inSheet().queryByRole("alert")).toBeNull();
  });
});
