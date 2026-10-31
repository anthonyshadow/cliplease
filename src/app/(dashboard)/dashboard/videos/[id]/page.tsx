import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FileStep } from "@/components/videos/file-step";
import { PostingsStep } from "@/components/videos/postings-step";
import { PublishedView } from "@/components/videos/published-view";
import { ReviewStep } from "@/components/videos/review-step";
import { RightsStep } from "@/components/videos/rights-step";
import { VideoPage as VideoPageContent } from "@/components/videos/video-page";
import { isUuid } from "@/lib/validation/uuid";
import { videoHref, videoStepFacts, videoStepHref } from "@/lib/videos/steps";
import {
  getCreatorForApi,
  requireCreator,
  toActor,
} from "@/server/auth/session";
import { payoutsStatusForPage } from "@/server/creators/profile";
import { env } from "@/server/env";
import { settleCreatorMoney } from "@/server/licensing/lazy";
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
 * posted (both sources), then Rights and Review. Past the draft, ?step=postings is Where posted, editable while
 * unpublished and read-only once published; ?step=rights is the Rights form; a published video's Review is the success
 * view Publish lands on; anything else is the video page (S19, videoView). Review reads the payouts status as Settings
 * does: again when back from payout setup (?payouts=returned, owner answer Q-94 a), then goes to its plain address; with
 * payouts active, the creator's pending and failed transfers are sent after the response (07 D75).
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

  const { step, connected, error, payouts } = await searchParams;
  // Back from payout setup (owner answer Q-94 a): the status read again, then the same address without ?payouts=, so a
  // later refresh doesn't read it again, whichever view the address now shows. The transfers go after the response,
  // never awaited before the redirect (Settings awaits them).
  if (payouts === "returned") {
    const status = await payoutsStatusForPage(ctx.creator.id, {
      row: ctx.creator,
      returned: true,
    });
    await settleCreatorMoney({
      creatorId: ctx.creator.id,
      payoutsStatus: status,
      wait: false,
    });
    redirect(
      typeof step === "string"
        ? `${videoHref(video.id)}?${new URLSearchParams({ step })}`
        : videoHref(video.id),
    );
  }
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
  if (view.kind === "rights") return <RightsStep video={video} />;
  if (view.kind === "review") {
    return (
      <ReviewStep
        actor={actor}
        video={video}
        handle={ctx.creator.handle}
        payoutsStatus={payoutsStatusForPage(ctx.creator.id, {
          row: ctx.creator,
        })}
        platformFeeBps={env.PLATFORM_FEE_BPS}
      />
    );
  }
  if (view.kind === "published") {
    return (
      <PublishedView
        videoId={video.id}
        slug={video.slug}
        handle={ctx.creator.handle}
      />
    );
  }
  if (view.kind === "video") {
    return (
      <VideoPageContent
        actor={actor}
        video={video}
        handle={ctx.creator.handle}
        platformFeeBps={env.PLATFORM_FEE_BPS}
      />
    );
  }
  // The paused percent after a reload (P10c): only an unfinished upload has one.
  const progress =
    video.originalStatus === "uploading"
      ? await getOriginalUploadProgress(actor, { videoId: video.id })
      : null;
  return <FileStep video={video} progress={progress} />;
}
