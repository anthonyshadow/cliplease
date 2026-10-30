// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Toaster, ToastOnMount, toast } from "./toast";

function Page({ message }: { message: string }) {
  return (
    <StrictMode>
      <Toaster />
      <ToastOnMount message={message} />
    </StrictMode>
  );
}

afterEach(cleanup);

describe("ToastOnMount", () => {
  it("shows each new message once, Strict Mode included", () => {
    const { rerender } = render(<Page message="Connected @maya.ruiz." />);
    expect(screen.getAllByText("Connected @maya.ruiz.")).toHaveLength(1);
    rerender(<Page message="That account is already connected." />);
    expect(
      screen.getAllByText("That account is already connected."),
    ).toHaveLength(1);
    rerender(<Page message="That account is already connected." />);
    expect(
      screen.getAllByText("That account is already connected."),
    ).toHaveLength(1);
  });
});

describe("toast's seal (04 §9.23)", () => {
  it("leads the approval toast with the decorative 16 px seal, and no other toast", () => {
    render(<Toaster />);
    act(() =>
      toast("Approved. CA$1,575.00 is on its way to your Stripe balance.", {
        seal: true,
      }),
    );
    act(() => toast("Link copied."));
    const approved = screen
      .getByText("Approved. CA$1,575.00 is on its way to your Stripe balance.")
      .closest("li");
    const seal = approved?.querySelector("svg");
    expect(seal?.getAttribute("aria-hidden")).toBe("true");
    expect(seal?.getAttribute("width")).toBe("16");
    expect(
      screen.getByText("Link copied.").closest("li")?.querySelector("svg"),
    ).toBeNull();
  });
});
