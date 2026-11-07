// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyText } from "./copy-text";

const CODE = "CL-7K3M-9QXA";

function clipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CopyText (05 §4.4 callouts 4 and 7; 04 §9.25)", () => {
  it("copies the text and reads Copied for 2 s, announced politely as Copied", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => {});
    clipboard(writeText);
    render(<CopyText text={CODE} name="license code" on="surface" />);
    const button = screen.getByRole("button", { name: "Copy license code" });
    await act(async () => fireEvent.click(button));
    expect(writeText).toHaveBeenCalledWith(CODE);
    expect(button.textContent).toBe("Copied");
    expect(button.getAttribute("aria-label")).toBe("Copied license code");
    expect(
      screen
        .getAllByText("Copied")
        .some((node) => node.closest("[aria-live='polite']")),
    ).toBe(true);
    act(() => vi.advanceTimersByTime(2000));
    expect(button.textContent).toBe("Copy");
  });

  it("selects the text with Press and hold to copy when there is no clipboard", async () => {
    clipboard(async () => {
      throw new Error("denied");
    });
    render(<CopyText text={CODE} name="license code" on="surface" />);
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(screen.getByText("Press and hold to copy")).toBeTruthy();
    expect(window.getSelection()?.toString()).toBe(CODE);
  });

  it.each([
    ["surface", "bg-fill"],
    ["fill", "bg-surface"],
  ] as const)(
    "is a borderless pill one step off a %s background (04 §2.2-8)",
    (on, tone) => {
      render(<CopyText text={CODE} name="license code" on={on} />);
      const pill = screen.getByRole("button");
      expect(pill.className).toContain(tone);
      expect(pill.className).toContain("border-transparent");
      expect(pill.className).toContain("hit-44");
    },
  );

  it("gives each copy on a page its own name", () => {
    render(
      <>
        <CopyText text={CODE} name="license code" on="surface" />
        <CopyText
          text="Video: @maya.films on Instagram"
          name="credit line"
          on="fill"
        />
      </>,
    );
    expect(
      screen.getByRole("button", { name: "Copy credit line" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy license code" }),
    ).toBeTruthy();
  });
});
