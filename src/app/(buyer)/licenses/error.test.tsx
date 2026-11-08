// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MyLicensesError from "./error";

afterEach(cleanup);

describe("My licenses' error (05 §4.9 States)", () => {
  it("keeps the two-tone title and says the list didn't load, in an alert", () => {
    render(<MyLicensesError retry={() => {}} />);
    const title = screen.getByRole("heading", { level: 1 });
    expect(title.textContent).toBe("My licenses. Everything you've licensed.");
    expect(title.querySelector(".text-ink-2")?.textContent).toBe(
      "Everything you've licensed.",
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't load your licenses. Try again.",
    );
  });

  it("re-fetches the segment with retry() on Try again", () => {
    const retry = vi.fn();
    render(<MyLicensesError retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
