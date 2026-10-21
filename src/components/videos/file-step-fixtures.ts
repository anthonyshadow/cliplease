// The File step tests' shared fixtures (P11): the mocks the File step islands need under jsdom, and Demo post 01 as a
// Library video's source post. A test whose components read the mocks imports this file first, as a bare import, so
// the mocks are in place before those components load.
import { vi } from "vitest";
import type { CreatorSourcePostDTO } from "@/server/videos/queries";
import type { FileStepLibrary } from "./file-step-upload";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/dashboard/videos/00000000-0000-4000-8000-000000000002",
}));
vi.mock("@/app/(dashboard)/dashboard/videos/[id]/actions", () => ({
  confirmSameVideo: vi.fn(),
}));

/** Demo post 01 as getVideoForCreator gives a Library video's source post. */
export const SOURCE_POST: CreatorSourcePostDTO = {
  platform: "mock",
  verified: true,
  verifiedUsername: "@demo.creator",
  postedAt: "2026-10-01T15:00:00.000Z",
  durationSec: 14,
  thumbnailSrc:
    "/api/library/thumbnails/00000000-0000-4000-8000-000000000001?v=1",
  width: 720,
  height: 1280,
};

/** The lines the server FileStep words for SOURCE_POST (provenanceLine, sourceNotice). */
export const PROVENANCE =
  "From Demo · @demo.creator · posted 1 Oct 2026 · Verified";
export const NOTICE =
  "Demo doesn't share original files with apps. Upload the original from your phone or camera, the version without the Demo watermark.";

/** The upload island's Library half for SOURCE_POST, before the tick. */
export const LIBRARY_STEP: FileStepLibrary = {
  post: SOURCE_POST,
  sameVideoConfirmed: false,
  provenance: PROVENANCE,
  notice: NOTICE,
};
