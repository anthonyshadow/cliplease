// The Make licensable steps and their routing (07 D39, D69). Pure. Staged: P11c inserts 'postings' after 'file'.

export const VIDEO_STEPS = ["file", "rights", "review"] as const;
export type VideoStep = (typeof VIDEO_STEPS)[number];

/** The Stepper's labels, in step order (04 §9.28). */
export const VIDEO_STEP_LABELS = ["File", "Rights", "Review"] as const;

/** What makes each step complete. File: the original is ready (P11 adds the same-video tick); Rights: answered (P13). */
export type VideoStepFacts = {
  originalReady: boolean;
  rightsAnswered: boolean;
};

export type VideoStepRoute =
  | { kind: "render"; step: VideoStep }
  | { kind: "redirect"; step: VideoStep };

/** A draft's step page: `/dashboard/videos/<id>?step=<step>`. */
export const videoStepHref = (videoId: string, step: VideoStep) =>
  `/dashboard/videos/${videoId}?step=${step}`;

const COMPLETE: Record<VideoStep, (f: VideoStepFacts) => boolean> = {
  file: (f) => f.originalReady,
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
