"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { TWO_COLUMN } from "@/components/layout/gutter";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { PRIMARY_WIDTH } from "@/components/ui/primary-width";
import { useClientValue } from "@/components/ui/use-client-value";
import { signInPath } from "@/lib/sign-in";
import { isIosDevice } from "@/lib/upload/device";
import { deriveFileStep } from "@/lib/upload/file-step-state";
import {
  checkOriginalFile,
  DROPZONE_COPY,
  hintsLine,
  milestoneAnnouncement,
  PAUSE_COPY,
  pausedPercent,
  type UploadErrorLine,
  uploadPercent,
} from "@/lib/upload/messages";
import {
  clearResumeHint,
  matchesResumeHint,
  type OriginalUploadProgress,
  type ResumeHint,
  readResumeHint,
} from "@/lib/upload/resume";
import { useUploadElsewhere } from "@/lib/upload/tab-presence";
import { browserHints } from "@/lib/upload/upload-original";
import {
  cancelOriginalUpload,
  markOriginalSeen,
  resumeOriginalUpload,
  retryOriginalUpload,
  startOriginalUpload,
  useBrowserOnline,
  useUploads,
} from "@/lib/upload/upload-store";
import { cn } from "@/lib/utils";
import { originalLine } from "@/lib/videos/video-page";
import type { CreatorVideoDTO } from "@/server/videos/queries";
import { PostSummary } from "./file-step-post-summary";
import { PosterPicker } from "./poster-picker";
import { type DropzoneView, UploadDropzone } from "./upload-dropzone";

export type FileStepVideo = Pick<
  CreatorVideoDTO,
  | "id"
  | "title"
  | "originalStatus"
  | "originalError"
  | "originalFilename"
  | "originalBytes"
  | "durationMs"
  | "width"
  | "height"
  | "posterSrc"
  | "posterOrigin"
  | "originalLocked"
>;

/**
 * A Library video's File step (P11; 07 D39): its source post's fixed lines, worded once by the server FileStep so the
 * island's progress renders don't rebuild them. The post's picture and the same-video tick are Where posted's (07 D69).
 */
export type FileStepLibrary = {
  /** provenanceLine: "From Demo · @demo.creator · posted 1 Oct 2026 · Verified". */
  provenance: string;
  /** sourceNotice: 01 J5.5's Notice. */
  notice: string;
};

/**
 * A Banner's two buttons, a secondary and a tertiary. Focus goes to the main one when the box appears, or to the other
 * where the main one ends something (Mismatch's Start again).
 */
function BoxActions({
  main,
  onMain,
  other,
  onOther,
  focusOther = false,
}: {
  main: string;
  onMain: () => void;
  other: string;
  onOther: () => void;
  focusOther?: boolean;
}) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        data-focus-target={focusOther ? undefined : ""}
        onClick={onMain}
      >
        {main}
      </Button>
      <Button
        variant="tertiary"
        size="sm"
        data-focus-target={focusOther ? "" : undefined}
        onClick={onOther}
      >
        {other}
      </Button>
    </span>
  );
}

/** The paused and mismatch boxes (04 §9.26): no status role, as the live region below speaks a pause and a mismatch. */
function PausedBox({
  children,
  action,
}: {
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <Banner tone="warning" live={false} action={action}>
      {children}
    </Banner>
  );
}

/**
 * The File step's live part (05 §6.5 Step 1, 04 §9.26): the dropzone over this tab's upload store (owner answer Q-42:
 * the upload carries on across the app's pages), the cover picker, the live region and Continue. With no upload in this
 * tab it shows what the server stored and this device remembers (P10c): none, paused after a reload (choose the same
 * file to resume), didn't finish, expired, failed or ready. Another tab uploading the same video locks it here (Q-49).
 *
 * Continue is a link to Where posted once the original is ready, for both sources (07 D69). A Library video (`library`,
 * P11) renders as the two children of the page's TWO_COLUMN grid (owner answer Q-66 a): the provenance line, then the
 * step (01 J5.5's Notice, the upload, the cover picker and Continue). On the video page (`replace`, P14b) it is the
 * Original file section's Replace: the done row names the file with its duration and size (originalLine), and there is
 * no cover picker (the page has its Cover image row) and no Continue.
 */
export function FileStepUpload({
  video,
  nextHref,
  replace,
  library,
  progress = null,
}: {
  video: FileStepVideo;
  /** A Library video's lines: the page's two columns. Left out for a plain upload's one column. */
  library?: FileStepLibrary;
  /** The server's resume state when the row is 'uploading' (the upload id and bytes only). */
  progress?: OriginalUploadProgress;
} & (
  | {
      /** Where Continue goes once the original is ready: `?step=postings`. */
      nextHref: string;
      replace?: never;
    }
  | { replace: true; nextHref?: never }
)) {
  const router = useRouter();
  const pathname = usePathname();
  const { originals, covers } = useUploads();
  const entry = originals[video.id] ?? null;
  const cover = covers[video.id] ?? null;
  const otherTab = useUploadElsewhere(video.id);
  const online = useBrowserOnline();
  // The iPhone hint is a device check, read after hydration (07 D152).
  const ios = useClientValue(
    () => isIosDevice(navigator.userAgent, navigator.maxTouchPoints),
    false,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // This device's hint, read after mount; a picked file that isn't the paused one; the server's view a Cancel was
  // pressed on (its rest holds until the page catches up).
  const [hint, setHint] = useState<ResumeHint | null | "unread">("unread");
  const [mismatchFile, setMismatchFile] = useState<File | null>(null);
  const [cancelledAt, setCancelledAt] = useState<string | null>(null);
  const helperId = useId();
  const bannerId = useId();
  const phase = entry?.phase;
  const lastPhase = useRef(phase);

  // What the server says changed (a refresh): read the hint again, and let go of a Cancel's rest for good (the server
  // coming back to the same view later, after another tab's upload, isn't that Cancel).
  const serverKey = `${video.originalStatus}|${video.originalError}|${progress?.state ?? ""}|${progress && "uploadId" in progress ? progress.uploadId : ""}`;
  const cancelledHere = cancelledAt === serverKey;
  useEffect(() => {
    setHint(readResumeHint(browserHints(), video.id));
    setCancelledAt((at) => (at === serverKey ? at : null));
  }, [serverKey, video.id]);

  const { box, running, elsewhere, showCover, clearHint } = deriveFileStep({
    entry,
    video,
    progress,
    hint,
    cancelledHere,
    mismatchHeld: mismatchFile !== null,
    problem: problem !== null,
    otherTab,
    tabCover: cover !== null,
    online,
  });
  const ready = box.kind === "done";
  const resumable = progress?.state === "resumable" ? progress : null;

  // A hint that names nothing to resume goes, unless another tab has written a newer one since.
  useEffect(() => {
    if (clearHint) clearResumeHint(browserHints(), video.id, clearHint);
  }, [clearHint, video.id]);

  // How it ended shows here, so the floating card won't show it again. Ended while this page was open: fetch it again.
  useEffect(() => {
    // A pause isn't an ending: the card shows it once the creator is on another page.
    if (phase === "done" || phase === "error" || phase === "canceled") {
      markOriginalSeen(video.id);
    }
    const before = lastPhase.current;
    lastPhase.current = phase;
    if (phase === before) return;
    if (phase === "done") {
      setAnnouncement(DROPZONE_COPY.attached);
      router.refresh();
    } else if (phase === "retrying") {
      setAnnouncement(DROPZONE_COPY.retrying);
    } else if (phase === "paused" && entry) {
      setAnnouncement(
        PAUSE_COPY.pausedSpoken(pausedPercent(entry.sent, entry.size)),
      );
    } else if (phase === "uploading" && before !== "retrying") {
      // Empty for each new upload or resume, so the same words are announced again.
      setAnnouncement("");
    }
  }, [phase, router, video.id, entry]);

  // 25 %, 50 % and 75 % for screen readers (04 §9.26), once each per upload, counted from where it starts (a resume
  // starts part way) and not again when a retry flips back.
  const percent = entry ? uploadPercent(entry.sent, entry.size) : 0;
  const lastPercent = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== "uploading" && phase !== "retrying") {
      lastPercent.current = null;
      return;
    }
    const before = lastPercent.current;
    lastPercent.current = percent;
    const said =
      before === null ? null : milestoneAnnouncement(before, percent);
    if (said) setAnnouncement(said);
  }, [percent, phase]);

  // Another tab's upload of this video ended: fetch the page again to show how.
  const wasElsewhere = useRef(elsewhere);
  useEffect(() => {
    if (wasElsewhere.current && !elsewhere) router.refresh();
    wasElsewhere.current = elsewhere;
  }, [elsewhere, router]);

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

  // Owner answer Q-41 a: keep a cover the creator chose; otherwise take a frame from the new file. A resume takes a
  // frame only when the video has no cover yet.
  const coverChosen =
    video.posterOrigin === "creator_image" ||
    (cover?.origin === "creator_image" && cover.phase !== "error");
  const hasCover =
    video.posterSrc !== null || (cover !== null && cover.phase !== "error");

  function begin(file: File, resume?: { uploadId: string; sent: number }) {
    const checked = checkOriginalFile(file);
    if (!checked.ok) {
      setProblem(checked.message);
      return;
    }
    setProblem(null);
    setMismatchFile(null);
    startOriginalUpload({
      videoId: video.id,
      title: video.title,
      file,
      contentType: checked.contentType,
      captureCover: resume ? !coverChosen && !hasCover : !coverChosen,
      resume,
    });
  }

  // The paused upload's file: the same one resumes, any other asks first (04 §9.26 Mismatch). A file that can't be
  // uploaded at all says so before either.
  function pickForPaused(file: File) {
    const checked = checkOriginalFile(file);
    if (!checked.ok) {
      setProblem(checked.message);
      setMismatchFile(null);
      return;
    }
    setProblem(null);
    if (
      hint !== "unread" &&
      hint &&
      resumable &&
      matchesResumeHint(hint, file)
    ) {
      begin(file, { uploadId: hint.uploadId, sent: resumable.doneBytes });
    } else {
      setMismatchFile(file);
      // Emptied first, so a second mismatched pick is spoken again.
      setAnnouncement("");
      requestAnimationFrame(() => setAnnouncement(PAUSE_COPY.mismatch));
    }
  }

  // The upload a reload left paused, named in its abort (this tab's own upload names itself).
  const pausedId = resumable?.uploadId ?? null;

  function cancel() {
    setCancelledAt(serverKey);
    setMismatchFile(null);
    void cancelOriginalUpload(video.id, pausedId).then(() => router.refresh());
  }

  // Start again (Mismatch): end the paused upload on the server, then upload the chosen file from zero.
  function startAgain(file: File | null) {
    void cancelOriginalUpload(video.id, pausedId);
    if (file) begin(file);
    else retryOriginalUpload(video.id, !coverChosen);
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

  let notice: ((pick: () => void) => ReactNode) | undefined;
  let noticeKey = "";
  let view: DropzoneView = { kind: "rest" };
  let onFile = (file: File) => begin(file);
  switch (box.kind) {
    case "done":
      view = {
        kind: "done",
        line: replace
          ? originalLine({
              ...(entry?.hints ?? video),
              originalFilename: entry?.fileName ?? video.originalFilename,
              originalBytes: entry?.size ?? video.originalBytes,
            })
          : hintsLine(entry?.hints ?? video),
        canReplace: !video.originalLocked,
      };
      break;
    case "mismatch":
      noticeKey = "mismatch";
      notice = (pick) => (
        <PausedBox
          action={
            <BoxActions
              main={PAUSE_COPY.startAgain}
              onMain={() => startAgain(mismatchFile)}
              other={PAUSE_COPY.chooseAnother}
              onOther={pick}
              focusOther
            />
          }
        >
          {PAUSE_COPY.mismatch}
        </PausedBox>
      );
      if (box.row) view = { kind: "paused", ...box.row };
      onFile = pickForPaused;
      break;
    case "uploading":
      view = { ...box, onCancel: cancel };
      break;
    case "checking":
      view = { kind: "checking", fileName: box.fileName };
      break;
    case "paused_here":
      // Same tab (owner answer Q-46 a): offline goes on by itself; out of retries, Resume (or back online).
      noticeKey = `paused-here|${box.pausedBy}`;
      notice = () => (
        <PausedBox
          action={
            box.pausedBy === "retries" ? (
              <BoxActions
                main={PAUSE_COPY.resume}
                onMain={() => resumeOriginalUpload(video.id)}
                other={DROPZONE_COPY.cancel}
                onOther={cancel}
              />
            ) : (
              <Button variant="tertiary" size="sm" onClick={cancel}>
                {DROPZONE_COPY.cancel}
              </Button>
            )
          }
        >
          {PAUSE_COPY.pausedHere(box.percent)}
        </PausedBox>
      );
      view = { kind: "paused", ...box.row };
      break;
    case "paused_reload":
      // After a reload or a closed tab: the file has to be chosen again.
      noticeKey = "paused-reload";
      notice = (pick) => (
        <PausedBox
          action={
            <BoxActions
              main={PAUSE_COPY.chooseFile}
              onMain={pick}
              other={DROPZONE_COPY.cancel}
              onOther={cancel}
            />
          }
        >
          {PAUSE_COPY.pausedAfterReload(box.percent)}
        </PausedBox>
      );
      view = { kind: "paused", ...box.row };
      onFile = pickForPaused;
      break;
    case "error":
      view = {
        kind: "error",
        fileName: box.fileName,
        message: box.line.message,
        action: errorAction(box.line.action),
      };
      break;
    case "not_finished":
      noticeKey = "not-finished";
      notice = () => (
        <Banner tone="warning">
          <span id={bannerId}>{DROPZONE_COPY.interrupted}</span>
        </Banner>
      );
      break;
  }

  const width = entry?.hints?.width ?? video.width;
  const height = entry?.hints?.height ?? video.height;
  // Until the original is ready: Continue disabled, with the helper unless an upload is on its way.
  const next = !nextHref ? null : ready ? (
    <Button asChild className={PRIMARY_WIDTH}>
      <Link href={nextHref}>Continue</Link>
    </Button>
  ) : (
    <div className="flex flex-col gap-2">
      <Button
        disabled
        aria-describedby={running || elsewhere ? undefined : helperId}
        className={PRIMARY_WIDTH}
      >
        Continue
      </Button>
      {running || elsewhere ? null : (
        <p id={helperId} className="text-footnote text-ink-2">
          {DROPZONE_COPY.continueHelper}
        </p>
      )}
    </div>
  );
  const step = (
    <>
      {elsewhere ? (
        <Banner tone="info">{DROPZONE_COPY.otherTab}</Banner>
      ) : (
        <div className="flex flex-col gap-2">
          <UploadDropzone
            view={view}
            onFile={onFile}
            notice={notice}
            noticeKey={noticeKey}
            describedBy={box.kind === "not_finished" ? bannerId : undefined}
          />
          {problem ? (
            <p role="alert" className="text-footnote text-danger-text">
              {problem}
            </p>
          ) : null}
          {ios ? (
            <p className="text-footnote text-ink-2">
              {DROPZONE_COPY.iphoneHint}
            </p>
          ) : null}
          {running ? (
            <p className="text-footnote text-ink-2">{DROPZONE_COPY.keepOpen}</p>
          ) : null}
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {showCover && !replace ? (
        <PosterPicker
          videoId={video.id}
          title={video.title}
          posterSrc={video.posterSrc}
          width={width}
          height={height}
        />
      ) : null}
      {next}
    </>
  );
  if (!library) return step;
  return (
    <>
      <PostSummary provenance={library.provenance} />
      <div
        data-file-step-body
        className={cn(TWO_COLUMN.main, "flex flex-col gap-6")}
      >
        <Notice>{library.notice}</Notice>
        {step}
      </div>
    </>
  );
}
