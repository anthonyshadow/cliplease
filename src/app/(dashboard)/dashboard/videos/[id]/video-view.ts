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
  | { kind: "rights" }
  | { kind: "review" }
  | { kind: "published" }
  | { kind: "video" };

/**
 * A draft goes through resolveStep: the requested step when every step before it is complete, else a redirect to the
 * first incomplete one; File, Where posted (editable, postingsStepMode), Rights and Review (P13). Past the draft,
 * ?step=postings is Where posted: editable while `unpublished`, read-only while `published` (05 frame 35); a published
 * video's Review is the success view, where Publish lands (P14a); everything else, and any `disabled` video, is the
 * video's header (P14a's minimal page, P14b's full one).
 */
export function videoView(
  video: { status: VideoStatus; facts: VideoStepFacts },
  requested: string | undefined,
): VideoView {
  if (video.status === "draft") {
    const route = resolveStep(video.facts, requested);
    if (route.kind === "redirect") return route;
    if (route.step === "postings") {
      return { kind: "postings", mode: postingsStepMode(video.status) };
    }
    return { kind: route.step };
  }
  if (requested === "postings" && video.status !== "disabled") {
    return { kind: "postings", mode: postingsStepMode(video.status) };
  }
  if (requested === "review" && video.status === "published") {
    return { kind: "published" };
  }
  return { kind: "video" };
}
