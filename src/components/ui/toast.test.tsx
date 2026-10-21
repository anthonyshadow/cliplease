// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Toaster, ToastOnMount } from "./toast";

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
