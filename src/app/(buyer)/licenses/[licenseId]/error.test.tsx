// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GENERIC_ERROR_MESSAGE } from "@/lib/result";
import MyLicenseError from "./error";

afterEach(cleanup);

describe("a license's error in My licenses (05 §10)", () => {
  it("says 05 §10's generic words, never the list's, with no column of its own", () => {
    const { container } = render(<MyLicenseError retry={() => {}} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      GENERIC_ERROR_MESSAGE,
    );
    expect(container.textContent).not.toContain("Couldn't load your licenses");
    expect(container.innerHTML).not.toMatch(/max-w-reading|py-6/);
  });

  it("re-fetches the segment with retry() on Try again", () => {
    const retry = vi.fn();
    render(<MyLicenseError retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
