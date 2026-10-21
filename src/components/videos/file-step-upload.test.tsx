// @vitest-environment jsdom
// First: its mocks must be in place before the upload island loads.
import "./file-step-fixtures";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LIBRARY_STEP, NOTICE, SOURCE_POST } from "./file-step-fixtures";
import { FileStepUpload, type FileStepVideo } from "./file-step-upload";

afterEach(cleanup);

const VIDEO_ID = "00000000-0000-4000-8000-000000000002";

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
const continueButton = () => screen.getByRole("button", { name: "Continue" });
const tick = () =>
  screen.queryByRole("checkbox", {
    name: "This file is the same video as the post",
  });

describe("FileStepUpload for a Library video (P11; owner answers Q-64 a, Q-66 a)", () => {
  it("before a file: the provenance line on the left, and the Notice, the dropzone and a disabled Continue on the right", () => {
    render(<FileStepUpload video={AT_REST} library={LIBRARY_STEP} />);
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
    expect(tick()).toBeNull();
    expect(continueButton()).toHaveProperty("disabled", true);
    expect(
      screen.getByText("Choose the original file to continue."),
    ).toBeTruthy();
  });

  it("attached: the post beside the cover, the cover picker in the step, then the tick and Continue", () => {
    render(<FileStepUpload video={READY} library={LIBRARY_STEP} />);
    expect(
      Array.from(
        summary()?.querySelectorAll("figcaption") ?? [],
        (c) => c.textContent,
      ),
    ).toEqual(["Post", "Cover image"]);
    // The picker's cover stays the one image named "Cover image for …".
    expect(
      screen.getAllByRole("img", { name: /^Cover image for / }),
    ).toHaveLength(1);
    expect(
      body()?.contains(screen.getByRole("region", { name: "Cover image" })),
    ).toBe(true);
    expect(tick()).not.toBeNull();
    expect(continueButton()).toHaveProperty("disabled", true);
    expect(screen.getByText("Tick the box to continue.")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("warns above the tick when the file and the post differ by more than 1 s", () => {
    render(
      <FileStepUpload
        video={READY}
        library={{
          ...LIBRARY_STEP,
          post: { ...SOURCE_POST, durationSec: 38 },
        }}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "This file is 0:14 but the post is 0:38. Make sure it's the same video.",
    );
  });

  it("starts ticked when the tick is stored", () => {
    render(
      <FileStepUpload
        video={READY}
        library={{ ...LIBRARY_STEP, sameVideoConfirmed: true }}
      />,
    );
    expect(tick()).toHaveProperty("checked", true);
    expect(continueButton()).toHaveProperty("disabled", false);
  });
});

describe("FileStepUpload for a plain upload (P10b, unchanged)", () => {
  it("has no post summary, Notice or tick, and Continue is a link once ready", () => {
    render(
      <FileStepUpload
        video={READY}
        nextHref={`/dashboard/videos/${VIDEO_ID}?step=rights`}
      />,
    );
    expect(summary()).toBeNull();
    expect(body()).toBeNull();
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(tick()).toBeNull();
    expect(
      screen.getByRole("link", { name: "Continue" }).getAttribute("href"),
    ).toBe(`/dashboard/videos/${VIDEO_ID}?step=rights`);
  });
});
