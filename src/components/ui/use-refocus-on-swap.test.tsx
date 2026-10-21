// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useRefocusOnSwap } from "./use-refocus-on-swap";

// A box whose one button is replaced on every step, and a button outside it.
function Swap({ step }: { step: string }) {
  const refocus = useRefocusOnSwap<HTMLDivElement>(step, ["button"]);
  return (
    <>
      <div {...refocus}>
        <button key={step} type="button">
          {step}
        </button>
      </div>
      <button type="button">Outside</button>
    </>
  );
}

const button = (name: string) => screen.getByRole("button", { name });

afterEach(cleanup);

describe("useRefocusOnSwap", () => {
  it("moves focus to the new control when the focused one is removed", () => {
    const { rerender } = render(<Swap step="Cancel" />);
    act(() => button("Cancel").focus());
    rerender(<Swap step="Try again" />);
    expect(document.activeElement).toBe(button("Try again"));
  });

  it("leaves focus on the page after a click away from the box", async () => {
    const { rerender } = render(<Swap step="Cancel" />);
    act(() => button("Cancel").focus());
    // A click on plain page text: focus falls to <body> with no relatedTarget, and the control stays.
    await act(async () => button("Cancel").blur());
    expect(document.activeElement).toBe(document.body);
    rerender(<Swap step="Try again" />);
    expect(document.activeElement).toBe(document.body);
  });

  it("still counts the box as focused after a window switch", async () => {
    const { rerender } = render(<Swap step="Cancel" />);
    act(() => button("Cancel").focus());
    // The window loses focus: blur with no relatedTarget, but the control stays the active element.
    await act(async () => {
      button("Cancel").dispatchEvent(
        new FocusEvent("focusout", { bubbles: true }),
      );
    });
    rerender(<Swap step="Try again" />);
    expect(document.activeElement).toBe(button("Try again"));
  });

  it("leaves focus alone once it moved to an element outside the box", () => {
    const { rerender } = render(<Swap step="Cancel" />);
    act(() => button("Cancel").focus());
    act(() => button("Outside").focus());
    act(() => button("Outside").blur());
    rerender(<Swap step="Try again" />);
    expect(document.activeElement).toBe(document.body);
  });
});
