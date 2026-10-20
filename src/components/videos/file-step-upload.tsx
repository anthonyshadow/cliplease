"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { PRIMARY_WIDTH } from "@/components/ui/primary-width";
import { formatDuration } from "@/lib/format";
import { signInPath } from "@/lib/sign-in";
import { isBadFileCode } from "@/lib/upload/codes";
import {
  attachedLine,
  checkOriginalFile,
  DROPZONE_COPY,
  milestoneAnnouncement,
  storedFailureLine,
  type UploadErrorLine,
  uploadErrorLine,
  uploadPercent,
} from "@/lib/upload/messages";
import {
  cancelOriginalUpload,
  isRunning,
  markOriginalSeen,
  retryOriginalUpload,
  startOriginalUpload,
  useUploads,
} from "@/lib/upload/upload-store";
import type { CreatorVideoDTO } from "@/server/videos/queries";
import { PosterPicker } from "./poster-picker";
import { type DropzoneView, UploadDropzone } from "./upload-dropzone";

export type FileStepVideo = Pick<
  CreatorVideoDTO,
  | "id"
  | "title"
  | "originalStatus"
  | "originalError"
  | "originalFilename"
  | "durationMs"
  | "width"
  | "height"
  | "posterSrc"
  | "posterOrigin"
  | "originalLocked"
>;

function hintsLine(h: {
  durationMs: number | null;
  width: number | null;
  height: number | null;
}) {
  return attachedLine({
    duration: h.durationMs ? formatDuration(h.durationMs / 1000) : null,
    width: h.width,
    height: h.height,
  });
}

/**
 * The File step's live part (05 §6.5 Step 1, 04 §9.26): the dropzone over this tab's upload store (owner answer Q-42:
 * the upload carries on across the app's pages), the cover picker, the live region and Continue. Without an upload in
 * this tab it shows what the server stored: none, interrupted ("Upload didn't finish"), failed or ready.
 */
export function FileStepUpload({
  video,
  nextHref,
}: {
  video: FileStepVideo;
  nextHref: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { originals, covers } = useUploads();
  const entry = originals[video.id] ?? null;
  const cover = covers[video.id] ?? null;
  const [problem, setProblem] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const helperId = useId();
  const bannerId = useId();
  const phase = entry?.phase;
  const running = phase !== undefined && isRunning(phase);
  const lastPhase = useRef(phase);

  // How it ended shows here, so the floating card won't show it again. Ended while this page was open: fetch it again
  // (ready, Replace, the stored hints); Cancel may have left the row 'uploading' with no original (a Replace's start
  // removes the old one).
  useEffect(() => {
    if (phase !== undefined && !isRunning(phase)) markOriginalSeen(video.id);
    const before = lastPhase.current;
    lastPhase.current = phase;
    if (phase === before) return;
    if (phase === "done") {
      setAnnouncement(DROPZONE_COPY.attached);
      router.refresh();
    } else if (phase === "canceled") {
      router.refresh();
    } else if (phase === "uploading") {
      // Empty for each new upload, so the same words are announced again.
      setAnnouncement("");
    }
  }, [phase, router, video.id]);

  // 25 %, 50 % and 75 % for screen readers (04 §9.26).
  const percent = entry ? uploadPercent(entry.sent, entry.size) : 0;
  const lastPercent = useRef(percent);
  useEffect(() => {
    const said =
      phase === "uploading"
        ? milestoneAnnouncement(lastPercent.current, percent)
        : null;
    lastPercent.current = phase === "uploading" ? percent : 0;
    if (said) setAnnouncement(said);
  }, [percent, phase]);

  // A file dropped beside the drop area must not open in the tab.
  useEffect(() => {
    const keep = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", keep);
    window.addEventListener("drop", keep);
    return () => {
      window.removeEventListener("dragover", keep);
      window.removeEventListener("drop", keep);
    };
  }, []);

  // Owner answer Q-41 a: keep a cover the creator chose; otherwise take a frame from the new file.
  const coverChosen =
    video.posterOrigin === "creator_image" ||
    (cover?.origin === "creator_image" && cover.phase !== "error");

  function start(file: File) {
    const checked = checkOriginalFile(file);
    if (!checked.ok) {
      setProblem(checked.message);
      return;
    }
    setProblem(null);
    startOriginalUpload({
      videoId: video.id,
      title: video.title,
      file,
      contentType: checked.contentType,
      captureCover: !coverChosen,
    });
  }

  // The error line's button: "retry" starts again with the same file, "sign_in" goes to sign in, "pick" (no onClick
  // or href) opens the dropzone's file picker.
  function errorAction(
    action: UploadErrorLine["action"],
  ): Extract<DropzoneView, { kind: "error" }>["action"] {
    if (action?.kind === "retry") {
      return {
        label: action.label,
        onClick: () => retryOriginalUpload(video.id, !coverChosen),
      };
    }
    if (action?.kind === "sign_in") {
      return { label: action.label, href: signInPath(`${pathname}?step=file`) };
    }
    return action && { label: action.label };
  }

  const ready = entry ? phase === "done" : video.originalStatus === "ready";
  // The tab that ran it reloaded or closed (P10c offers resume instead).
  const interrupted = !entry && video.originalStatus === "uploading";
  const errorLine = entry
    ? phase === "error"
      ? uploadErrorLine(entry.error ?? "internal", {
          size: entry.size,
          online: navigator.onLine,
        })
      : null
    : video.originalStatus === "failed"
      ? storedFailureLine(video.originalError)
      : null;
  // A file the browser refused (`problem`) shows its line under the empty drop area, not under an older error.
  const view: DropzoneView = ready
    ? {
        kind: "done",
        line: hintsLine(entry?.hints ?? video),
        canReplace: !video.originalLocked,
      }
    : entry?.phase === "uploading"
      ? {
          kind: "uploading",
          fileName: entry.fileName,
          sent: entry.sent,
          total: entry.size,
          onCancel: () => cancelOriginalUpload(video.id),
        }
      : entry?.phase === "checking"
        ? { kind: "checking", fileName: entry.fileName }
        : errorLine && !problem
          ? {
              kind: "error",
              fileName: entry?.fileName ?? video.originalFilename,
              message: errorLine.message,
              action: errorAction(errorLine.action),
            }
          : { kind: "rest" };

  // A file the server couldn't read as a video gets no cover section: "Your file is fine" would contradict it.
  const badFile = entry
    ? isBadFileCode(entry.error)
    : video.originalStatus === "failed" &&
      video.originalError !== "upload_expired";
  const showCover =
    !badFile &&
    ((entry !== null && phase !== "canceled") ||
      video.originalStatus === "ready" ||
      video.posterSrc !== null ||
      cover !== null);

  return (
    <>
      {interrupted ? (
        <Banner tone="warning">
          <span id={bannerId}>{DROPZONE_COPY.interrupted}</span>
        </Banner>
      ) : null}
      <div className="flex flex-col gap-2">
        <UploadDropzone
          view={view}
          onFile={start}
          describedBy={interrupted ? bannerId : undefined}
        />
        {problem ? (
          <p role="alert" className="text-footnote text-danger-text">
            {problem}
          </p>
        ) : null}
        {running ? (
          <p className="text-footnote text-ink-2">{DROPZONE_COPY.keepOpen}</p>
        ) : null}
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {showCover ? (
        <PosterPicker
          videoId={video.id}
          title={video.title}
          posterSrc={video.posterSrc}
          width={entry?.hints?.width ?? video.width}
          height={entry?.hints?.height ?? video.height}
        />
      ) : null}
      {ready ? (
        <Button asChild className={PRIMARY_WIDTH}>
          <Link href={nextHref}>Continue</Link>
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            disabled
            aria-describedby={running ? undefined : helperId}
            className={PRIMARY_WIDTH}
          >
            Continue
          </Button>
          {running ? null : (
            <p id={helperId} className="text-footnote text-ink-2">
              {DROPZONE_COPY.continueHelper}
            </p>
          )}
        </div>
      )}
    </>
  );
}
