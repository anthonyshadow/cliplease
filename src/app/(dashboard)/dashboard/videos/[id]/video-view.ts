// What /dashboard/videos/[id] renders for a video and its ?step= (07 D39, D69): pure, so the routing is unit-tested
// apart from the page.
import type { VideoStatus } from "@/lib/domain/values";
import { type PostingsStepMode, postingsStepMode } from "@/lib/postings/form";
import {
  resolveStep,
  type VideoStep,
  type VideoStepFacts,
} from "@/lib/videos/steps";

export type VideoView =
  | { kind: "redirect"; step: VideoStep }
  | { kind: "file" }
  | { kind: "postings"; mode: PostingsStepMode }
  | { kind: "step_placeholder"; step: Extract<VideoStep, "rights" | "review"> }
  | { kind: "video_placeholder" };

/**
 * A draft goes through resolveStep: the requested step when every step before it is complete, else a redirect to the
 * first incomplete one; Where posted is editable (postingsStepMode). Past the draft only ?step=postings has a page so
 * far: editable while `unpublished`, read-only while `published` (05 frame 35). Everything else, and any `disabled` video, keeps P10b's
 * placeholder until P14a builds the video page.
 */
export function videoView(
  video: { status: VideoStatus; facts: VideoStepFacts },
  requested: string | undefined,
): VideoView {
  if (video.status === "draft") {
    const route = resolveStep(video.facts, requested);
    if (route.kind === "redirect") return route;
    if (route.step === "file") return { kind: "file" };
    if (route.step === "postings") {
      return { kind: "postings", mode: postingsStepMode(video.status) };
    }
    return { kind: "step_placeholder", step: route.step };
  }
  if (requested === "postings" && video.status !== "disabled") {
    return { kind: "postings", mode: postingsStepMode(video.status) };
  }
  return { kind: "video_placeholder" };
}
