// The video component tests' CreatorVideoDTO (P10b–P13): a fresh upload draft as getVideoForCreator gives it. Tests only.
import type { CreatorVideoDTO } from "@/server/videos/queries";

/** A new upload draft "Beach day", nothing done yet, with `change` on top. */
export const creatorVideoFixture = (
  change: Partial<CreatorVideoDTO> = {},
): CreatorVideoDTO => ({
  id: "00000000-0000-4000-8000-000000000002",
  title: "Beach day",
  slug: "beach-day",
  slugLocked: false,
  containsMusic: null,
  identifiablePeople: null,
  rightsLock: null,
  status: "draft",
  originalStatus: "none",
  originalError: null,
  originalFilename: null,
  originalBytes: null,
  durationMs: null,
  width: null,
  height: null,
  posterSrc: null,
  posterOrigin: null,
  originalLocked: false,
  rightsAnswered: false,
  source: "upload",
  postingsConfirmedAt: null,
  sameVideoConfirmed: false,
  hasVerifiedPosting: false,
  sourcePost: null,
  ...change,
});
