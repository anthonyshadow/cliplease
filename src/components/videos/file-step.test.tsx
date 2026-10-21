// @vitest-environment jsdom
// First: its mocks must be in place before the File step loads.
import "./file-step-fixtures";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreatorVideoDTO } from "@/server/videos/queries";
import { FileStep } from "./file-step";
import { NOTICE, SOURCE_POST } from "./file-step-fixtures";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const UPLOAD: CreatorVideoDTO = {
  id: "00000000-0000-4000-8000-000000000002",
  title: "Beach day",
  status: "draft",
  originalStatus: "none",
  originalError: null,
  originalFilename: null,
  durationMs: null,
  width: null,
  height: null,
  posterSrc: null,
  posterOrigin: null,
  originalLocked: false,
  rightsAnswered: false,
  source: "upload",
  sameVideoConfirmed: false,
  sourcePost: null,
};
const LIBRARY: CreatorVideoDTO = {
  ...UPLOAD,
  title: "He saw snow for the first time and lost it",
  source: "library",
  sourcePost: SOURCE_POST,
};

const back = () => screen.getByRole("link", { name: "Back" });
const connectNote = () =>
  screen.queryByRole("link", { name: "Connect an account" });

describe("FileStep", () => {
  it("a plain upload stays P10b's one reading column: Back to Videos and the upload-only note", () => {
    const { container } = render(<FileStep video={UPLOAD} />);
    expect(back().getAttribute("href")).toBe("/dashboard/videos");
    expect(connectNote()).not.toBeNull();
    expect(container.firstElementChild?.className).toContain("max-w-reading");
    expect(container.querySelector("[data-post-summary]")).toBeNull();
  });

  it("a Library video: Back to the Library (owner answer Q-63 b), the two-column grid, no upload-only note and no visible heading", () => {
    const { container } = render(<FileStep video={LIBRARY} />);
    expect(back().getAttribute("href")).toBe("/dashboard/library");
    expect(connectNote()).toBeNull();
    const page = container.firstElementChild;
    expect(page?.className).toContain("max-w-reading");
    expect(page?.className).toContain("lg:grid-cols-12");
    expect(
      Array.from(page?.children ?? [], (child) =>
        child.hasAttribute("data-post-summary")
          ? "summary"
          : child.hasAttribute("data-file-step-body")
            ? "step"
            : "header",
      ),
    ).toEqual(["header", "summary", "step"]);
    expect(screen.getByRole("heading", { level: 1 }).className).toContain(
      "sr-only",
    );
  });

  it("a Library video: the post's provenance line and Notice, worded on the server", () => {
    const { container } = render(<FileStep video={LIBRARY} />);
    expect(container.querySelector("[data-post-summary]")?.textContent).toBe(
      "From Demo · @demo.creator · posted 1 Oct 2026 · Verified",
    );
    expect(
      container.querySelector("[data-file-step-body]")?.textContent,
    ).toContain(NOTICE);
  });

  it("refuses a Library video without its source post (07 D66 keeps exactly one)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(<FileStep video={{ ...LIBRARY, sourcePost: null }} />),
    ).toThrow("library_video_without_source_post");
  });
});
