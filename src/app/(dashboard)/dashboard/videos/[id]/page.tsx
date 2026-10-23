import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FileStep } from "@/components/videos/file-step";
import { PostingsStep } from "@/components/videos/postings-step";
import {
  StepPlaceholder,
  VideoPlaceholder,
} from "@/components/videos/step-placeholder";
import { isUuid } from "@/lib/validation/uuid";
import { videoHref, videoStepFacts, videoStepHref } from "@/lib/videos/steps";
import {
  getCreatorForApi,
  requireCreator,
  toActor,
} from "@/server/auth/session";
import { getOriginalUploadProgress } from "@/server/storage/uploads";
import { getVideoForCreator } from "@/server/videos/queries";
import { videoView } from "./video-view";

// Where posted calls the platforms from this page's Server Actions (02 §6.1; Next sets an action's limit on its page): a
// Continue verifies up to 12 links one by one, Check again one, and Sync and check again syncs each account first.
export const maxDuration = 60;

export async function generateMetadata({
  params,
}: PageProps<"/dashboard/videos/[id]">): Promise<Metadata> {
  const { id } = await params;
  const ctx = await getCreatorForApi();
  const video = ctx ? await getVideoForCreator(toActor(ctx), id) : null;
  return { title: video?.title ?? "Videos" };
}

/**
 * /dashboard/videos/[id] (07 D39, D69): the creator's own video, else 404. A draft renders `?step=` when every step
 * before it is complete, otherwise it goes to the first incomplete one (a missing or unknown step too): File, then Where
 * posted (both sources), then Rights and Review, placeholders until P13. Past the draft, ?step=postings is Where posted,
 * editable while unpublished and read-only once published; anything else is a placeholder until P14a (videoView).
 */
export default async function VideoPage({
  params,
  searchParams,
}: PageProps<"/dashboard/videos/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCreator(videoHref(id));
  const actor = toActor(ctx);
  const video = await getVideoForCreator(actor, id);
  if (!video) notFound();

  const { step, connected, error } = await searchParams;
  const view = videoView(
    { status: video.status, facts: videoStepFacts(video) },
    typeof step === "string" ? step : undefined,
  );
  if (view.kind === "redirect") redirect(videoStepHref(video.id, view.step));
  if (view.kind === "postings") {
    return (
      <PostingsStep
        actor={actor}
        video={video}
        mode={view.mode}
        connected={connected}
        connectError={error}
      />
    );
  }
  if (view.kind === "step_placeholder") {
    return <StepPlaceholder videoId={video.id} step={view.step} />;
  }
  if (view.kind === "video_placeholder") {
    return <VideoPlaceholder title={video.title} />;
  }
  // The paused percent after a reload (P10c): only an unfinished upload has one.
  const progress =
    video.originalStatus === "uploading"
      ? await getOriginalUploadProgress(actor, { videoId: video.id })
      : null;
  return <FileStep video={video} progress={progress} />;
}
