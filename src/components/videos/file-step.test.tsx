// @vitest-environment jsdom
// First: its mocks must be in place before the File step loads.
import "../../../tests/helpers/file-step-fixtures";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreatorVideoDTO } from "@/server/videos/queries";
import { creatorVideoFixture } from "../../../tests/helpers/creator-video-fixture";
import { NOTICE, SOURCE_POST } from "../../../tests/helpers/file-step-fixtures";
import { FileStep } from "./file-step";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const UPLOAD = creatorVideoFixture();
const LIBRARY: CreatorVideoDTO = {
  ...UPLOAD,
  title: "He saw snow for the first time and lost it",
  source: "library",
  hasVerifiedPosting: true,
  sourcePost: SOURCE_POST,
};
/** The original is attached: 14 s, while the source post below is 38 s (the old File-step warning's case). */
const READY = {
  originalStatus: "ready",
  originalFilename: "sample.mp4",
  durationMs: 14_000,
  width: 720,
  height: 1280,
  posterSrc: "/poster.jpg?v=abcd1234",
  posterOrigin: "frame_capture",
} satisfies Partial<CreatorVideoDTO>;

const back = () => screen.getByRole("link", { name: "Back" });
const connectNote = () =>
  screen.queryByRole("link", { name: "Connect an account" });

/**
 * None of what moved to Where posted (07 D69; owner answer Q-81 a): the J5.6 upload note, the post's picture, the
 * duration warning and the tick.
 */
function expectNothingMoved() {
  expect(connectNote()).toBeNull();
  expect(
    screen.queryByText(/Connect the account to get a Verified label/),
  ).toBeNull();
  expect(
    document.querySelector('img[src^="/api/library/thumbnails/"]'),
  ).toBeNull();
  expect(document.querySelector("figure")).toBeNull();
  expect(screen.queryByText(/Make sure it's the same video/)).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByText(/same video/)).toBeNull();
}

describe("FileStep", () => {
  it("a plain upload stays P10b's one reading column with Back to Videos, and no upload-only note (it moved to Where posted)", () => {
    const { container } = render(<FileStep video={UPLOAD} />);
    expect(back().getAttribute("href")).toBe("/dashboard/videos");
    expect(container.firstElementChild?.className).toContain("max-w-reading");
    expect(container.querySelector("[data-post-summary]")).toBeNull();
    expectNothingMoved();
  });

  it("a Library video: Back to the Library (owner answer Q-63 b), the two-column grid, and no visible heading", () => {
    const { container } = render(<FileStep video={LIBRARY} />);
    expect(back().getAttribute("href")).toBe("/dashboard/library");
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

  it.each([
    ["a plain upload", UPLOAD],
    ["a Library video", LIBRARY],
  ])(
    "%s, once the original is ready: Continue goes to Where posted, and nothing that moved there shows (07 D69)",
    (_, video) => {
      render(
        <FileStep
          video={{
            ...video,
            ...READY,
            sourcePost: video.sourcePost && {
              ...video.sourcePost,
              durationSec: 38,
            },
          }}
        />,
      );
      expect(
        screen.getByRole("link", { name: "Continue" }).getAttribute("href"),
      ).toBe(`/dashboard/videos/${UPLOAD.id}?step=postings`);
      expectNothingMoved();
    },
  );

  it("refuses a Library video without its source post (07 D66 keeps exactly one)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(<FileStep video={{ ...LIBRARY, sourcePost: null }} />),
    ).toThrow("library_video_without_source_post");
  });
});
