// The Where-posted tests' shared fixtures (P11c): the Server Action mocks the form needs under jsdom, Radix's
// ResizeObserver, and saved postings as listVideoPostings gives them. A test whose components read the mocks imports
// this file first, as a bare import, so the mocks are in place before those components load.
import { vi } from "vitest";
import type { OwnerPostingDTO } from "@/lib/postings/types";
import type { PostingsFormVideo } from "./postings-form";

vi.mock("@/app/(dashboard)/dashboard/videos/[id]/actions", () => ({
  saveVideoPostings: vi.fn(),
  recheckPosting: vi.fn(),
}));
vi.mock("@/app/(dashboard)/dashboard/_actions/social", () => ({
  syncAccount: vi.fn(),
}));

// Radix's Switch measures its control; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

export const VIDEO_ID = "00000000-0000-4000-8000-000000000002";
export const ACCOUNT_ID = "00000000-0000-4000-8000-0000000000a1";
/** Demo post 01's own link (the mock permalink, 07 D68) and post 02's. */
export const DEMO_01 = "https://example.com/mock/mock_post_abc12345_01";
export const DEMO_02 = "https://example.com/mock/mock_post_abc12345_02";
/** The Demo start route coming back to this step, as 07 D37 encodes it. */
export const LINK_DEMO_HREF = `/api/connect/mock/start?returnTo=%2Fdashboard%2Fvideos%2F${VIDEO_ID}%3Fstep%3Dpostings`;

/** The video, its 14 s original attached, with its cover: an upload, or a Library video once given SOURCE_POSTING. */
export const VIDEO: PostingsFormVideo = {
  id: VIDEO_ID,
  durationMs: 14_000,
  posterSrc: `/api/media/posters/${VIDEO_ID}?v=abcd1234`,
  width: 720,
  height: 1280,
  sameVideoConfirmed: false,
};

/** A saved posting (a verified Demo post 02 unless overridden). */
export function savedPosting(over: Partial<OwnerPostingDTO>): OwnerPostingDTO {
  return {
    id: "00000000-0000-4000-8000-0000000000b2",
    platform: "mock",
    label: "Demo",
    url: DEMO_02,
    isSource: false,
    verification: "verified",
    unverifiedReason: null,
    verifiedUsername: "@demo.creator",
    verifiedAccountLinkedAt: "2026-10-01T09:00:00.000Z",
    accountStatus: "connected",
    thumbnailSrc:
      "/api/library/thumbnails/00000000-0000-4000-8000-0000000000c2?v=1",
    durationSec: 38,
    visibility: "public",
    showLink: true,
    checkedAt: "2026-10-20T10:00:00.000Z",
    position: 1,
    ...over,
  };
}

/** A Library video's source posting: Demo post 01 (14 s), locked and verified. */
export const SOURCE_POSTING = savedPosting({
  id: "00000000-0000-4000-8000-0000000000b1",
  isSource: true,
  url: DEMO_01,
  thumbnailSrc:
    "/api/library/thumbnails/00000000-0000-4000-8000-0000000000c1?v=1",
  durationSec: 14,
  position: 0,
});

/** An unverified saved posting with its reason. */
export const unverified = (
  over: Partial<OwnerPostingDTO> & Pick<OwnerPostingDTO, "unverifiedReason">,
) =>
  savedPosting({
    verification: "unverified",
    verifiedUsername: null,
    accountStatus: null,
    thumbnailSrc: null,
    durationSec: null,
    visibility: null,
    checkedAt: null,
    ...over,
  });
