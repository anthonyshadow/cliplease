// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StepPlaceholder } from "./step-placeholder";

afterEach(cleanup);

const VIDEO_ID = "00000000-0000-4000-8000-000000000002";

describe("StepPlaceholder (P10b; 07 D69's four steps)", () => {
  it("Rights is step 3 of 4, and Back goes to Where posted", () => {
    render(<StepPlaceholder videoId={VIDEO_ID} step="rights" />);
    expect(screen.getByText("Step 3 of 4 · Rights")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Back" }).getAttribute("href"),
    ).toBe(`/dashboard/videos/${VIDEO_ID}?step=postings`);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Rights",
    );
  });

  it("Review is step 4 of 4, and Back goes to Rights", () => {
    render(<StepPlaceholder videoId={VIDEO_ID} step="review" />);
    expect(screen.getByText("Step 4 of 4 · Review")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Back" }).getAttribute("href"),
    ).toBe(`/dashboard/videos/${VIDEO_ID}?step=rights`);
  });
});
