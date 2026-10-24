// The Make licensable steps, their routing and the hrefs around them (07 D69): File → Where posted → Rights → Review,
// for a Library video and a plain upload alike. Pure.
import type { OriginalFileStatus } from "../domain/values";

export const VIDEO_STEPS = ["file", "postings", "rights", "review"] as const;
export type VideoStep = (typeof VIDEO_STEPS)[number];

/** The Stepper's labels, in step order (04 §9.28, 07 D69): "Step 2 of 4 · Where posted" below md. */
export const VIDEO_STEP_LABELS = [
  "File",
  "Where posted",
  "Rights",
  "Review",
] as const;

/**
 * What makes each step complete (07 D69). File: the original is ready. Where posted: saved (also as "I haven't posted
 * it anywhere yet.") and, once a posting is verified, "These posts show this same video" ticked. Rights: answered (P13).
 */
export type VideoStepFacts = {
  originalReady: boolean;
  postingsDone: boolean;
  rightsAnswered: boolean;
};

/**
 * The facts of a creator's video as getVideoForCreator / getVideoStepFacts give them. `hasVerifiedPosting` is the stored
 * `ownership = 'verified_owner'` summary (07 D66); the tick is required whatever the source (D69), and is not asked
 * while nothing is verified.
 */
export function videoStepFacts(video: {
  originalStatus: OriginalFileStatus;
  postingsConfirmedAt: string | null;
  hasVerifiedPosting: boolean;
  sameVideoConfirmed: boolean;
  rightsAnswered: boolean;
}): VideoStepFacts {
  return {
    originalReady: video.originalStatus === "ready",
    postingsDone:
      video.postingsConfirmedAt !== null &&
      (!video.hasVerifiedPosting || video.sameVideoConfirmed),
    rightsAnswered: video.rightsAnswered,
  };
}

export type VideoStepRoute =
  | { kind: "render"; step: VideoStep }
  | { kind: "redirect"; step: VideoStep };

/** The new-video page: the plain upload's title page (05 §6.6), and with `?post=` a post's Source page. */
export const NEW_VIDEO_PATH = "/dashboard/videos/new";

/**
 * A post's Source page (05 §6.5): where its Library tile goes (07 D39), and where Reconnect comes back to (07 D37:
 * parseReturnTo keeps `post`).
 */
export const sourcePageHref = (postId: string) =>
  `${NEW_VIDEO_PATH}?post=${postId}`;

/** A creator's video page; a draft's redirects to its first incomplete step (resolveStep). */
export const videoHref = (videoId: string) => `/dashboard/videos/${videoId}`;

/**
 * The step pages' heading (the video's title, for screen readers; VideoStepFrame): where focus goes when the control it
 * was on goes away.
 */
export const STEP_HEADING_ID = "video-step-title";

/** A draft's step page: `/dashboard/videos/<id>?step=<step>`. */
export const videoStepHref = (videoId: string, step: VideoStep) =>
  `${videoHref(videoId)}?step=${step}`;

const COMPLETE: Record<VideoStep, (f: VideoStepFacts) => boolean> = {
  file: (f) => f.originalReady,
  postings: (f) => f.postingsDone,
  rights: (f) => f.rightsAnswered,
  review: () => false,
};

const isVideoStep = (step: string): step is VideoStep =>
  (VIDEO_STEPS as readonly string[]).includes(step);

/**
 * `?step=` for a draft: the requested step when every step before it is complete; otherwise (and for a missing or
 * unknown step) a redirect to the first incomplete one.
 */
export function resolveStep(
  facts: VideoStepFacts,
  requested: string | null | undefined,
): VideoStepRoute {
  const firstIncomplete =
    VIDEO_STEPS.find((step) => !COMPLETE[step](facts)) ?? "review";
  if (!requested || !isVideoStep(requested)) {
    return { kind: "redirect", step: firstIncomplete };
  }
  const reachable =
    VIDEO_STEPS.indexOf(requested) <= VIDEO_STEPS.indexOf(firstIncomplete);
  return reachable
    ? { kind: "render", step: requested }
    : { kind: "redirect", step: firstIncomplete };
}
