import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FileStep } from "@/components/videos/file-step";
import {
  StepPlaceholder,
  VideoPlaceholder,
} from "@/components/videos/step-placeholder";
import { isUuid } from "@/lib/validation/uuid";
import { resolveStep, videoStepHref } from "@/lib/videos/steps";
import {
  getCreatorForApi,
  requireCreator,
  toActor,
} from "@/server/auth/session";
import { getVideoForCreator } from "@/server/videos/queries";

export async function generateMetadata({
  params,
}: PageProps<"/dashboard/videos/[id]">): Promise<Metadata> {
  const { id } = await params;
  const ctx = await getCreatorForApi();
  const video = ctx ? await getVideoForCreator(toActor(ctx), id) : null;
  return { title: video?.title ?? "Videos" };
}

/**
 * /dashboard/videos/[id] (07 D39): the creator's own video, else 404. A draft renders `?step=` when every step before it
 * is complete, otherwise it goes to the first incomplete one (a missing or unknown step too); Rights and Review are
 * placeholders until P13, and any other status a placeholder until P14a.
 */
export default async function VideoPage({
  params,
  searchParams,
}: PageProps<"/dashboard/videos/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCreator(`/dashboard/videos/${id}`);
  const video = await getVideoForCreator(toActor(ctx), id);
  if (!video) notFound();
  if (video.status !== "draft") return <VideoPlaceholder title={video.title} />;

  const { step } = await searchParams;
  const route = resolveStep(
    {
      originalReady: video.originalStatus === "ready",
      rightsAnswered: video.rightsAnswered,
    },
    typeof step === "string" ? step : undefined,
  );
  if (route.kind === "redirect") redirect(videoStepHref(video.id, route.step));
  return route.step === "file" ? (
    <FileStep video={video} />
  ) : (
    <StepPlaceholder videoId={video.id} step={route.step} />
  );
}
