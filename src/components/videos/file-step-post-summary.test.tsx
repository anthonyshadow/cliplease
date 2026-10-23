// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PROVENANCE } from "./file-step-fixtures";
import { PostSummary } from "./file-step-post-summary";

afterEach(cleanup);

const summary = () =>
  document.querySelector<HTMLElement>("[data-post-summary]");

describe("PostSummary (05 §6.5 callout 9; owner answers Q-66 a, Q-81 a)", () => {
  it("is the provenance line only: no post picture, cover or caption (they moved to Where posted, 07 D69)", () => {
    render(<PostSummary provenance={PROVENANCE} />);
    expect(summary()?.textContent).toBe(
      "From Demo · @demo.creator · posted 1 Oct 2026 · Verified",
    );
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("figure")).toBeNull();
  });

  it("is the left column from lg (07 D146)", () => {
    render(<PostSummary provenance={PROVENANCE} />);
    expect(summary()?.className).toContain("lg:col-span-5");
  });
});
