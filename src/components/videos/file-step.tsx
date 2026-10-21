import Link from "next/link";
import { READING_COLUMN, TWO_COLUMN } from "@/components/layout/gutter";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui/stepper";
import { LIBRARY_PATH } from "@/lib/library/filter";
import type { OriginalUploadProgress } from "@/lib/upload/resume";
import { cn } from "@/lib/utils";
import { provenanceLine, sourceNotice } from "@/lib/videos/source-page";
import {
  VIDEO_STEP_LABELS,
  VIDEO_STEPS,
  videoStepHref,
} from "@/lib/videos/steps";
import type { CreatorVideoDTO } from "@/server/videos/queries";
import { BackLink } from "./back-link";
import { FileStepUpload, type FileStepVideo } from "./file-step-upload";

/** What the upload island reads of the video: no source post, tick or rights. */
function uploadVideo(video: CreatorVideoDTO): FileStepVideo {
  return {
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
  };
}

/**
 * Step 1 · File (05 §6.5, §6.6; 07 D39, D80). A plain upload: one centered max-w-reading column at every tier (07 D145)
 * with the Stepper, "‹ Back" to Videos (owner answer Q-40 a), the upload island, and the upload-only note (01 J5.6,
 * staged here until P11c moves it to Where posted). A Library video: see LibraryFileStep. The page has no visible
 * heading; the title is its h1 for readers.
 */
export function FileStep({
  video,
  progress = null,
}: {
  video: CreatorVideoDTO;
  /** The server's resume state of an 'uploading' original (P10c): the upload id and bytes, never a key. */
  progress?: OriginalUploadProgress;
}) {
  if (video.source === "library") {
    return <LibraryFileStep video={video} progress={progress} />;
  }
  return (
    <div className={READING_COLUMN}>
      <BackLink href="/dashboard/videos">Back</BackLink>
      <h1 className="sr-only">{video.title}</h1>
      <Stepper
        steps={VIDEO_STEP_LABELS}
        current={VIDEO_STEPS.indexOf("file")}
      />
      <FileStepUpload
        video={uploadVideo(video)}
        nextHref={videoStepHref(video.id, "rights")}
        progress={progress}
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

/**
 * A Library video's File step (P11; 05 §6.5 Step 1, callouts 9–12; 07 D39, D146): "‹ Back" to the Library at every
 * tier with no visible heading (owner answer Q-63 b), the Stepper, then the post summary and the step. Below lg one
 * centered max-w-reading column with the summary above the step; from lg the summary on the left and the whole upload
 * island on the right (Q-66 a), in max-w-app (TWO_COLUMN). No upload-only note: the video is already verified. The
 * post's lines are worded here, once, rather than on each of the island's progress renders.
 */
function LibraryFileStep({
  video,
  progress,
}: {
  video: CreatorVideoDTO;
  progress: OriginalUploadProgress;
}) {
  const post = video.sourcePost;
  // createVideoFromPost writes the source posting with the video, and a referenced post is never deleted (07 D66).
  if (!post) throw new Error("library_video_without_source_post");
  return (
    <div className={TWO_COLUMN.page}>
      <div className={cn(TWO_COLUMN.span, "flex flex-col gap-6")}>
        <BackLink href={LIBRARY_PATH}>Back</BackLink>
        <h1 className="sr-only">{video.title}</h1>
        <Stepper
          steps={VIDEO_STEP_LABELS}
          current={VIDEO_STEPS.indexOf("file")}
        />
      </div>
      <FileStepUpload
        video={uploadVideo(video)}
        library={{
          post,
          sameVideoConfirmed: video.sameVideoConfirmed,
          provenance: provenanceLine({ ...post, name: post.verifiedUsername }),
          notice: sourceNotice(post.platform),
        }}
        progress={progress}
      />
    </div>
  );
}
