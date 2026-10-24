import type { ReactNode } from "react";
import { TWO_COLUMN } from "@/components/layout/gutter";
import { Stepper } from "@/components/ui/stepper";
import { cn } from "@/lib/utils";
import { provenanceLine } from "@/lib/videos/source-page";
import {
  STEP_HEADING_ID,
  VIDEO_STEP_LABELS,
  VIDEO_STEPS,
  type VideoStep,
} from "@/lib/videos/steps";
import type { CreatorVideoDTO } from "@/server/videos/queries";
import { BackLink } from "./back-link";
import { VideoSummary } from "./video-summary";

/**
 * The step layout Where posted, Rights and Review share (S17, S17b; 05 §6.5; 07 D146, D156): "‹ Back" and, for a draft,
 * the Stepper over both columns, with the title as the sr-only h1; then the video summary (from md) and the step, marked
 * `data-step`. One centered max-w-reading column below lg, two columns in max-w-app from lg (TWO_COLUMN).
 */
export function VideoStepFrame({
  video,
  step,
  backHref,
  stepper = true,
  children,
}: {
  video: CreatorVideoDTO;
  step: Exclude<VideoStep, "file">;
  backHref: string;
  /** The draft Stepper; an unpublished video's Where posted has none. */
  stepper?: boolean;
  children: ReactNode;
}) {
  const post = video.sourcePost;
  return (
    <div className={TWO_COLUMN.page}>
      <div className={cn(TWO_COLUMN.span, "flex flex-col gap-6")}>
        <BackLink href={backHref}>Back</BackLink>
        <h1 id={STEP_HEADING_ID} tabIndex={-1} className="sr-only">
          {video.title}
        </h1>
        {stepper ? (
          <Stepper
            steps={VIDEO_STEP_LABELS}
            current={VIDEO_STEPS.indexOf(step)}
          />
        ) : null}
      </div>
      <VideoSummary
        className={TWO_COLUMN.side}
        video={video}
        provenance={
          post ? provenanceLine({ ...post, name: post.verifiedUsername }) : null
        }
      />
      <div
        data-step={step}
        className={cn(TWO_COLUMN.main, "flex flex-col gap-6")}
      >
        {children}
      </div>
    </div>
  );
}
