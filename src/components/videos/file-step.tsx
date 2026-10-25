import { READING_COLUMN, TWO_COLUMN } from "@/components/layout/gutter";
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
export function uploadVideo(video: CreatorVideoDTO): FileStepVideo {
  return {
    id: video.id,
    title: video.title,
    originalStatus: video.originalStatus,
    originalError: video.originalError,
    originalFilename: video.originalFilename,
    originalBytes: video.originalBytes,
    durationMs: video.durationMs,
    width: video.width,
    height: video.height,
    posterSrc: video.posterSrc,
    posterOrigin: video.posterOrigin,
    originalLocked: video.originalLocked,
  };
}

/**
 * Step 1 · File (05 §6.5, §6.6; 07 D39, D69, D80). A plain upload: one centered max-w-reading column at every tier
 * (07 D145) with the Stepper, "‹ Back" to Videos (owner answer Q-40 a) and the upload island. A Library video: see
 * LibraryFileStep. Either way Continue goes to Where posted once the original is ready (07 D69), which now holds the
 * upload-only note (01 J5.6) and the same-video tick (owner answer Q-81 a). The page has no visible heading; the title
 * is its h1 for readers.
 */
export function FileStep({
  video,
  progress = null,
}: {
  video: CreatorVideoDTO;
  /** The server's resume state of an 'uploading' original (P10c): the upload id and bytes, never a key. */
  progress?: OriginalUploadProgress;
}) {
  const nextHref = videoStepHref(video.id, "postings");
  if (video.source === "library") {
    return (
      <LibraryFileStep video={video} nextHref={nextHref} progress={progress} />
    );
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
        nextHref={nextHref}
        progress={progress}
      />
    </div>
  );
}

/**
 * A Library video's File step (P11; 05 §6.5 Step 1, callouts 9–12; 07 D39, D146): "‹ Back" to the Library at every
 * tier with no visible heading (owner answer Q-63 b), the Stepper, then the provenance line and the step. Below lg one
 * centered max-w-reading column with the line above the step; from lg the line on the left and the whole upload island
 * on the right (Q-66 a), in max-w-app (TWO_COLUMN). The post's picture, the duration warning and the tick live on
 * Where posted (07 D69); the post's lines are worded here, once, rather than on each of the island's progress renders.
 */
function LibraryFileStep({
  video,
  nextHref,
  progress,
}: {
  video: CreatorVideoDTO;
  nextHref: string;
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
        nextHref={nextHref}
        library={{
          provenance: provenanceLine({ ...post, name: post.verifiedUsername }),
          notice: sourceNotice(post.platform),
        }}
        progress={progress}
      />
    </div>
  );
}
