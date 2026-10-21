// The Make licensable steps, their routing and the hrefs around them (07 D39, D69). Pure. Staged: P11c inserts
// 'postings' after 'file'.
import type { OriginalFileStatus, VideoSource } from "../domain/values";

export const VIDEO_STEPS = ["file", "rights", "review"] as const;
export type VideoStep = (typeof VIDEO_STEPS)[number];

/** The Stepper's labels, in step order (04 §9.28). */
export const VIDEO_STEP_LABELS = ["File", "Rights", "Review"] as const;

/**
 * What makes each step complete. File: the original is ready and the same-video tick is done (07 D39; P11c moves the
 * tick to Where posted, D69); Rights: answered (P13).
 */
export type VideoStepFacts = {
  originalReady: boolean;
  /** "This file is the same video as the post" is ticked, or the video needs no tick: only a Library video asks. */
  sameVideoDone: boolean;
  rightsAnswered: boolean;
};

/** The facts of a creator's video as getVideoForCreator gives it (P11: only Library videos need the tick). */
export function videoStepFacts(video: {
  originalStatus: OriginalFileStatus;
  source: VideoSource;
  sameVideoConfirmed: boolean;
  rightsAnswered: boolean;
}): VideoStepFacts {
  return {
    originalReady: video.originalStatus === "ready",
    sameVideoDone: video.source !== "library" || video.sameVideoConfirmed,
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

/** A draft's step page: `/dashboard/videos/<id>?step=<step>`. */
export const videoStepHref = (videoId: string, step: VideoStep) =>
  `${videoHref(videoId)}?step=${step}`;

const COMPLETE: Record<VideoStep, (f: VideoStepFacts) => boolean> = {
  file: (f) => f.originalReady && f.sameVideoDone,
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
