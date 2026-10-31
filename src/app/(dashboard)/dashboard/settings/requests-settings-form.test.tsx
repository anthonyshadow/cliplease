// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/toast";
import { APPROVAL_WINDOW_LABEL, REQUESTS_SETTINGS_COPY } from "@/lib/payouts";
import { formError } from "@/lib/result";
import { updateCreatorSettings } from "./actions";
import { RequestsSettingsForm } from "./requests-settings-form";

vi.mock("./actions", () => ({ updateCreatorSettings: vi.fn() }));

const save = vi.mocked(updateCreatorSettings);

beforeAll(() => {
  // Radix's Switch measures its control; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderForm(
  props: Partial<ComponentProps<typeof RequestsSettingsForm>> = {},
) {
  return render(
    <>
      <Toaster />
      <RequestsSettingsForm
        approvalWindowHours={72}
        autoApprove={false}
        payoutsActive
        {...props}
      />
    </>,
  );
}

const toggle = () =>
  screen.getByRole("switch", { name: REQUESTS_SETTINGS_COPY.autoApprove });
const checked = () => toggle().getAttribute("aria-checked");

/** The value the hidden field posts for the Switch. */
const posted = () =>
  document.querySelector<HTMLInputElement>('input[name="autoApprove"]')?.value;

/** An element's accessible description: the text of its aria-describedby ids, in order. */
const description = (el: HTMLElement) =>
  (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent)
    .join(" ");

const pressSave = () =>
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

describe("RequestsSettingsForm (05 §6.11 callouts 4 and 8; 07 D81)", () => {
  it("selects the stored window among the four tiles, and describes the group with New requests only.", () => {
    renderForm();
    const group = screen.getByRole("group", {
      name: REQUESTS_SETTINGS_COPY.approvalWindow,
    });
    const radios = within(group).getAllByRole<HTMLInputElement>("radio");
    expect(radios.map((r) => r.labels?.[0]?.textContent)).toEqual(
      Object.values(APPROVAL_WINDOW_LABEL),
    );
    expect(radios.map((r) => [r.value, r.checked])).toEqual([
      ["24", false],
      ["48", false],
      ["72", true],
      ["120", false],
    ]);
    expect(description(group)).toBe(REQUESTS_SETTINGS_COPY.newRequestsOnly);
  });

  it("turns auto-approve on and off while payouts are active, posting on or off", () => {
    renderForm();
    expect(toggle().getAttribute("aria-disabled")).toBeNull();
    expect(description(toggle())).toBe(
      REQUESTS_SETTINGS_COPY.autoApproveHelper,
    );
    expect([checked(), posted()]).toEqual(["false", "off"]);
    fireEvent.click(toggle());
    expect([checked(), posted()]).toEqual(["true", "on"]);
    fireEvent.click(toggle());
    expect([checked(), posted()]).toEqual(["false", "off"]);
  });

  it("locks the Switch off while payouts aren't active, with the lock reason in place of the helper", () => {
    renderForm({ payoutsActive: false });
    expect(toggle().getAttribute("aria-disabled")).toBe("true");
    expect(description(toggle())).toBe(
      REQUESTS_SETTINGS_COPY.autoApproveLocked,
    );
    // The switch itself, then its label.
    for (const target of [
      toggle(),
      screen.getByText(REQUESTS_SETTINGS_COPY.autoApprove),
    ]) {
      fireEvent.click(target);
      expect([checked(), posted()]).toEqual(["false", "off"]);
    }
  });

  it("lets a stored on be turned off while payouts aren't active (owner answer Q-153)", () => {
    renderForm({ autoApprove: true, payoutsActive: false });
    expect(toggle().getAttribute("aria-disabled")).toBeNull();
    expect(description(toggle())).toBe(
      REQUESTS_SETTINGS_COPY.autoApproveHelper,
    );
    expect([checked(), posted()]).toEqual(["true", "on"]);
    fireEvent.click(toggle());
    expect([checked(), posted()]).toEqual(["false", "off"]);
  });

  it("posts only the hidden field, and on a payouts refusal shows it under the Switch, back at the stored off", async () => {
    const { rerender } = renderForm();
    fireEvent.click(toggle());
    save.mockResolvedValueOnce(
      formError("payouts_not_active", REQUESTS_SETTINGS_COPY.autoApproveLocked),
    );
    pressSave();
    await waitFor(() =>
      expect(toggle().getAttribute("aria-invalid")).toBe("true"),
    );
    const formData = save.mock.calls[0]?.[1];
    expect(formData?.getAll("autoApprove")).toEqual(["on"]);
    expect(formData?.get("approvalWindowHours")).toBe("72");
    expect(description(toggle())).toBe(
      `${REQUESTS_SETTINGS_COPY.autoApproveLocked} ${REQUESTS_SETTINGS_COPY.autoApproveHelper}`,
    );
    expect(screen.getByRole("alert").textContent).toBe(
      REQUESTS_SETTINGS_COPY.autoApproveLocked,
    );
    expect([checked(), posted()]).toEqual(["false", "off"]);
    expect(document.activeElement).toBe(toggle());
    // The action revalidates: the page comes back with payouts not active, and the lock reason says it once.
    rerender(
      <>
        <Toaster />
        <RequestsSettingsForm
          approvalWindowHours={72}
          autoApprove={false}
          payoutsActive={false}
        />
      </>,
    );
    expect(toggle().getAttribute("aria-disabled")).toBe("true");
    expect(toggle().getAttribute("aria-invalid")).toBeNull();
    expect(description(toggle())).toBe(
      REQUESTS_SETTINGS_COPY.autoApproveLocked,
    );
  });

  it("toasts Saved. once the action answers ok", async () => {
    renderForm();
    save.mockResolvedValueOnce({ ok: true, data: undefined });
    pressSave();
    expect(await screen.findByText(REQUESTS_SETTINGS_COPY.saved)).toBeTruthy();
    expect(toggle().getAttribute("aria-invalid")).toBeNull();
  });
});
