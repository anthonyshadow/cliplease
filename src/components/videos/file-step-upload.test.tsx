// @vitest-environment jsdom
// First: its mocks must be in place before the upload island loads.
import "./file-step-fixtures";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LIBRARY_STEP, NOTICE } from "./file-step-fixtures";
import { FileStepUpload, type FileStepVideo } from "./file-step-upload";

afterEach(cleanup);

const VIDEO_ID = "00000000-0000-4000-8000-000000000002";
const NEXT = `/dashboard/videos/${VIDEO_ID}?step=postings`;

const AT_REST: FileStepVideo = {
  id: VIDEO_ID,
  title: "He saw snow for the first time and lost it",
  originalStatus: "none",
  originalError: null,
  originalFilename: null,
  durationMs: null,
  width: null,
  height: null,
  posterSrc: null,
  posterOrigin: null,
  originalLocked: false,
};
const READY: FileStepVideo = {
  ...AT_REST,
  originalStatus: "ready",
  originalFilename: "sample.mp4",
  durationMs: 14_000,
  width: 720,
  height: 1280,
  posterSrc: `/api/media/posters/${VIDEO_ID}?v=abcd1234`,
  posterOrigin: "frame_capture",
};

const summary = () =>
  document.querySelector<HTMLElement>("[data-post-summary]");
const body = () => document.querySelector<HTMLElement>("[data-file-step-body]");
const continueLink = () => screen.getByRole("link", { name: "Continue" });

describe("FileStepUpload for a Library video (P11; owner answers Q-66 a, Q-81 a)", () => {
  it("before a file: the provenance line on the left, and the Notice, the dropzone and a disabled Continue on the right", () => {
    render(
      <FileStepUpload video={AT_REST} nextHref={NEXT} library={LIBRARY_STEP} />,
    );
    expect(summary()?.textContent).toBe(
      "From Demo · @demo.creator · posted 1 Oct 2026 · Verified",
    );
    expect(
      (summary()?.compareDocumentPosition(body() as Node) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(body()?.className).toContain("lg:col-span-7");
    expect(body()?.textContent).toContain(NOTICE);
    expect(body()?.querySelector("[data-dropzone]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      screen.getByText("Choose the original file to continue."),
    ).toBeTruthy();
  });

  it("attached: the cover picker in the step and Continue a link to Where posted, with no same-video piece (07 D69)", () => {
    render(
      <FileStepUpload video={READY} nextHref={NEXT} library={LIBRARY_STEP} />,
    );
    expect(summary()?.textContent).toBe(
      "From Demo · @demo.creator · posted 1 Oct 2026 · Verified",
    );
    expect(summary()?.querySelector("img, figure")).toBeNull();
    // The picker's cover is the step's one image.
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img", { name: /^Cover image for / })).toBeTruthy();
    expect(
      body()?.contains(screen.getByRole("region", { name: "Cover image" })),
    ).toBe(true);
    expect(body()?.contains(continueLink())).toBe(true);
    expect(continueLink().getAttribute("href")).toBe(NEXT);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Tick the box to continue.")).toBeNull();
  });
});

describe("FileStepUpload for a plain upload (P10b)", () => {
  it("has no post summary, Notice or tick, and Continue is a link to Where posted once ready", () => {
    render(<FileStepUpload video={READY} nextHref={NEXT} />);
    expect(summary()).toBeNull();
    expect(body()).toBeNull();
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(continueLink().getAttribute("href")).toBe(NEXT);
  });
});
