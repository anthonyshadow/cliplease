import Link from "next/link";
import { READING_COLUMN } from "@/components/layout/gutter";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui/stepper";
import {
  VIDEO_STEP_LABELS,
  VIDEO_STEPS,
  videoStepHref,
} from "@/lib/videos/steps";
import type { CreatorVideoDTO } from "@/server/videos/queries";
import { BackLink } from "./back-link";
import { FileStepUpload } from "./file-step-upload";

/**
 * Step 1 · File for a plain upload (05 §6.5, §6.6; 07 D39, D80): one centered max-w-reading column at every tier (07
 * D145). The Stepper, "‹ Back" to Videos (owner answer Q-40 a), the upload island, and the upload-only note (01 J5.6,
 * staged here until P11c moves it to Where posted). The page has no visible heading; the title is its h1 for readers.
 */
export function FileStep({ video }: { video: CreatorVideoDTO }) {
  return (
    <div className={READING_COLUMN}>
      <BackLink href="/dashboard/videos">Back</BackLink>
      <h1 className="sr-only">{video.title}</h1>
      <Stepper
        steps={VIDEO_STEP_LABELS}
        current={VIDEO_STEPS.indexOf("file")}
      />
      <FileStepUpload
        video={{
          id: video.id,
          title: video.title,
          originalStatus: video.originalStatus,
          originalError: video.originalError,
          originalFilename: video.originalFilename,
          durationMs: video.durationMs,
          width: video.width,
          height: video.height,
          posterSrc: video.posterSrc,
          posterOrigin: video.posterOrigin,
          originalLocked: video.originalLocked,
        }}
        nextHref={videoStepHref(video.id, "rights")}
      />
      <div className="flex flex-col items-start gap-1">
        <p className="text-callout text-ink-2">
          Is this video on Instagram, TikTok or YouTube? Connect the account to
          get a Verified label.
        </p>
        <Button asChild variant="link">
          <Link href="/dashboard/connections">Connect an account</Link>
        </Button>
      </div>
    </div>
  );
}
