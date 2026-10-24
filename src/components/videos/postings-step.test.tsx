// @vitest-environment jsdom
// First: its mocks must be in place before the step loads.
import "./postings-fixtures";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listPostingAccountStates } from "@/server/library/queries";
import { listVideoPostings } from "@/server/postings/queries";
import type { CreatorVideoDTO } from "@/server/videos/queries";
import { creatorVideoFixture } from "./creator-video-fixture";
import { SOURCE_POSTING, VIDEO_ID } from "./postings-fixtures";
import { PostingsStep } from "./postings-step";

vi.mock("@/server/postings/queries", () => ({ listVideoPostings: vi.fn() }));
vi.mock("@/server/library/queries", () => ({
  listPostingAccountStates: vi.fn(),
}));
vi.mock("@/server/social/registry", () => ({
  enabledPlatforms: () => ["mock"],
  mockEnabled: () => true,
}));

const postings = vi.mocked(listVideoPostings);
const accounts = vi.mocked(listPostingAccountStates);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ACTOR = {
  kind: "creator",
  userId: "u",
  creatorId: "c",
} as const;

const UPLOAD = creatorVideoFixture({
  id: VIDEO_ID,
  originalStatus: "ready",
  originalFilename: "sample.mp4",
  durationMs: 14_000,
  width: 720,
  height: 1280,
  posterSrc: `/api/media/posters/${VIDEO_ID}?v=abcd1234`,
  posterOrigin: "frame_capture",
});
const LIBRARY: CreatorVideoDTO = {
  ...UPLOAD,
  source: "library",
  hasVerifiedPosting: true,
  sourcePost: {
    platform: "mock",
    verified: true,
    verifiedUsername: "@demo.creator",
    postedAt: "2026-10-01T15:00:00.000Z",
    durationSec: 14,
    thumbnailSrc: SOURCE_POSTING.thumbnailSrc,
    width: 720,
    height: 1280,
  },
};

async function renderStep(
  video: CreatorVideoDTO,
  mode: "edit" | "read_only" = "edit",
  search: { connected?: string; error?: string } = {},
) {
  postings.mockResolvedValueOnce(
    video.source === "library" ? [SOURCE_POSTING] : [],
  );
  accounts.mockResolvedValueOnce([]);
  return render(
    await PostingsStep({
      actor: ACTOR,
      video,
      mode,
      connected: search.connected,
      connectError: search.error,
    }),
  );
}

describe("PostingsStep", () => {
  it("a draft: Back to the File step, the title for readers, the Stepper on Where posted, and the form", async () => {
    await renderStep(UPLOAD);
    expect(
      screen.getByRole("link", { name: "Back" }).getAttribute("href"),
    ).toBe(`/dashboard/videos/${VIDEO_ID}?step=file`);
    expect(screen.getByRole("heading", { level: 1 }).className).toContain(
      "sr-only",
    );
    expect(screen.getByText("Step 2 of 4 · Where posted")).toBeTruthy();
    expect(document.querySelector('[aria-current="step"]')?.textContent).toBe(
      "Where posted",
    );
    expect(document.querySelector("[data-step=postings] form")).not.toBeNull();
  });

  it("lays out per tier: one 640 column, the summary hidden below md and left of the step from lg", async () => {
    const { container } = await renderStep(UPLOAD);
    const page = container.firstElementChild as HTMLElement;
    expect(page.className).toContain("max-w-reading");
    expect(page.className).toContain("lg:max-w-app");
    const summary = container.querySelector(
      "[data-video-summary]",
    ) as HTMLElement;
    expect(summary.className).toContain("hidden");
    expect(summary.className).toContain("md:flex");
    expect(summary.className).toContain("lg:col-span-5");
    expect(
      container.querySelector("[data-step=postings]")?.className,
    ).toContain("lg:col-span-7");
    expect(summary.textContent).toContain(
      "Original attached · 0:14 · 720 × 1280",
    );
    expect(summary.querySelector("img")?.getAttribute("src")).toBe(
      UPLOAD.posterSrc,
    );
  });

  it("a Library video's summary carries its provenance line; an upload's has none", async () => {
    await renderStep(LIBRARY);
    const summary = document.querySelector(
      "[data-video-summary]",
    ) as HTMLElement;
    expect(summary.textContent).toContain(
      "From Demo · @demo.creator · posted 1 Oct 2026 · Verified",
    );
    cleanup();
    await renderStep(UPLOAD);
    expect(
      document.querySelector("[data-video-summary]")?.textContent,
    ).not.toContain("From ");
  });

  it("shows a connect's ?error= line in a Banner, and reads ?connected= as a provider only", async () => {
    await renderStep(UPLOAD, "edit", { error: "denied", connected: "mock" });
    const step = document.querySelector("[data-step=postings]") as HTMLElement;
    expect(within(step).getByRole("status").textContent).toBe(
      "Nothing was linked.",
    );
    cleanup();
    await renderStep(UPLOAD, "edit", { error: "<script>" });
    expect(
      document.querySelector("[data-step=postings] [role=status]"),
    ).toBeNull();
  });

  it("an unpublished video: editable, no Stepper, Back to the video's page", async () => {
    await renderStep({
      ...UPLOAD,
      status: "unpublished",
      postingsConfirmedAt: "2026-10-20T10:00:00.000Z",
    });
    expect(
      screen.getByRole("link", { name: "Back" }).getAttribute("href"),
    ).toBe(`/dashboard/videos/${VIDEO_ID}`);
    expect(screen.queryByText(/Step 2 of 4/)).toBeNull();
    expect(document.querySelector("form")).not.toBeNull();
  });

  it("read-only: the Notice and the cards, no form, chips or Stepper", async () => {
    await renderStep({ ...LIBRARY, status: "published" }, "read_only");
    expect(
      screen.getByText("Turn off to edit where it was posted."),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Where was it posted?",
    );
    expect(document.querySelector("form")).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.queryByText(/Step 2 of 4/)).toBeNull();
    expect(
      document.querySelector("[data-posting-source]")?.textContent,
    ).toContain("@demo.creator on Demo");
    expect(accounts).not.toHaveBeenCalled();
  });
});
