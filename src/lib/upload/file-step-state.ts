// What the File step shows (04 §9.26, 05 §6.5 Step 1; P10c; owner answers Q-46, Q-49): the box over the drop area and
// the lines around it, from this tab's upload, what the server stored and this device's resume hint. Pure: the File
// step keeps the effects and the handlers.
import type { OriginalFileStatus } from "../domain/values";
import { isBadFileCode } from "./codes";
import {
  pausedPercent,
  storedFailureLine,
  type UploadErrorLine,
  uploadErrorLine,
} from "./messages";
import type { OriginalUploadProgress, ResumeHint } from "./resume";
import { isLive, isRunning, type OriginalEntry } from "./upload-store";

export type FileStepInput = {
  /** This tab's upload of the video. */
  entry: Pick<
    OriginalEntry,
    "phase" | "pausedBy" | "fileName" | "size" | "sent" | "error"
  > | null;
  video: {
    originalStatus: OriginalFileStatus;
    originalError: string | null;
    originalFilename: string | null;
    posterSrc: string | null;
  };
  /** The server's resume state when the row is 'uploading'; null when it couldn't read it. */
  progress: OriginalUploadProgress;
  /** This device's hint, read after mount ("unread" until then). */
  hint: ResumeHint | null | "unread";
  /** A Cancel here waits for the page to catch up: rest until then. */
  cancelledHere: boolean;
  /** A picked file that isn't the paused one is held. */
  mismatchHeld: boolean;
  /** A file check's line shows under the drop area. */
  problem: boolean;
  /** Another tab of this browser uploads the video (Q-49). */
  otherTab: boolean;
  /** This tab holds a cover for the video, in any phase. */
  tabCover: boolean;
  /** Offline, a failed upload's line says so. */
  online: boolean;
};

/** The row under a paused box: the bar frozen at the bytes stored. */
export type PausedRow = { fileName: string; sent: number; total: number };

/**
 * The box, first match: done; mismatch (over the paused row when the server can resume); this tab's upload (uploading,
 * checking, paused here, its error line); else what the server stored (paused after a reload, its error line, didn't
 * finish); else rest. A file check's problem hides the error line.
 */
export type FileStepBox =
  | { kind: "rest" }
  | { kind: "done" }
  | { kind: "mismatch"; row: PausedRow | null }
  | {
      kind: "uploading";
      fileName: string;
      sent: number;
      total: number;
      retrying: boolean;
    }
  | { kind: "checking"; fileName: string }
  | {
      kind: "paused_here";
      pausedBy: OriginalEntry["pausedBy"];
      percent: number;
      row: PausedRow;
    }
  | { kind: "paused_reload"; percent: number; row: PausedRow }
  | { kind: "error"; fileName: string | null; line: UploadErrorLine }
  | { kind: "not_finished" };

export type FileStep = {
  box: FileStepBox;
  /** This tab's parts or complete are in flight. */
  running: boolean;
  /** Another tab's upload locks the video here (Q-49). */
  elsewhere: boolean;
  showCover: boolean;
  /** This device's hint names nothing to resume: it goes. */
  clearHint: boolean;
};

type Stored =
  | "rest"
  | "paused"
  | "not_finished"
  | "expired"
  | "bad_file"
  | "done";

/**
 * What the server stored, with no upload in this tab (P10c Task 2): ready → done; failed → expired for
 * `upload_expired`, else bad_file; uploading → expired when the server says so, paused when this device's hint names the
 * open upload, else not_finished; none → rest.
 */
function storedState(
  video: FileStepInput["video"],
  progress: OriginalUploadProgress,
  hintUploadId: string | null,
): Stored {
  switch (video.originalStatus) {
    case "ready":
      return "done";
    case "failed":
      return video.originalError === "upload_expired" ? "expired" : "bad_file";
    case "uploading":
      if (progress?.state === "expired") return "expired";
      if (
        progress?.state === "resumable" &&
        hintUploadId === progress.uploadId
      ) {
        return "paused";
      }
      return "not_finished";
    default:
      return "rest";
  }
}

function boxOf(
  i: FileStepInput,
  stored: Stored | null,
  pausedRow: PausedRow | null,
): FileStepBox {
  const { entry, video } = i;
  if (stored === "done" || entry?.phase === "done") return { kind: "done" };
  if (
    i.mismatchHeld ||
    (entry?.phase === "error" && entry.error === "not_same_file")
  ) {
    return { kind: "mismatch", row: pausedRow };
  }
  if (entry) {
    const { phase, fileName, sent, size } = entry;
    if (phase === "uploading" || phase === "retrying") {
      return {
        kind: "uploading",
        fileName,
        sent,
        total: size,
        retrying: phase === "retrying",
      };
    }
    if (phase === "checking") return { kind: "checking", fileName };
    if (phase === "paused") {
      return {
        kind: "paused_here",
        pausedBy: entry.pausedBy,
        percent: pausedPercent(sent, size),
        row: { fileName, sent, total: size },
      };
    }
    const line =
      phase === "error"
        ? uploadErrorLine(entry.error ?? "internal", { size, online: i.online })
        : null;
    return line && !i.problem
      ? { kind: "error", fileName, line }
      : { kind: "rest" };
  }
  if (stored === "paused" && pausedRow) {
    return {
      kind: "paused_reload",
      percent: pausedPercent(pausedRow.sent, pausedRow.total),
      row: pausedRow,
    };
  }
  if ((stored === "bad_file" || stored === "expired") && !i.problem) {
    return {
      kind: "error",
      fileName: video.originalFilename,
      line: storedFailureLine(
        stored === "expired" ? "upload_expired" : video.originalError,
      ),
    };
  }
  return stored === "not_finished"
    ? { kind: "not_finished" }
    : { kind: "rest" };
}

export function deriveFileStep(i: FileStepInput): FileStep {
  const { entry, video, progress, otherTab } = i;
  const hint = i.hint === "unread" ? null : i.hint;
  const resumable = progress?.state === "resumable" ? progress : null;
  // With no upload in this tab, the server's state and this device's hint decide (P10c Task 6). Before the hint is read,
  // an open upload the server can resume counts as this device's, the likely case, so the box doesn't jump after
  // hydration.
  const stored =
    entry || i.cancelledHere
      ? null
      : storedState(
          video,
          progress,
          i.hint === "unread"
            ? (resumable?.uploadId ?? null)
            : (hint?.uploadId ?? null),
        );
  const pausedRow = resumable && {
    fileName: hint?.name || video.originalFilename || "",
    sent: resumable.doneBytes,
    total: resumable.size,
  };
  // Another tab uploads this video (Q-49): the lock holds unless this tab's own upload of it is live.
  const ownLive = entry !== null && isLive(entry.phase);
  const elsewhere = otherTab && !ownLive;
  // A file the server couldn't read as a video gets no cover section: "Your file is fine" would contradict it.
  const badFile = entry ? isBadFileCode(entry.error) : stored === "bad_file";
  return {
    box: boxOf(i, stored, pausedRow),
    running: entry !== null && isRunning(entry.phase),
    elsewhere,
    showCover:
      !badFile &&
      !elsewhere &&
      ((entry !== null && entry.phase !== "canceled") ||
        video.originalStatus === "ready" ||
        video.posterSrc !== null ||
        i.tabCover),
    // Any state but paused; an open upload the server couldn't read just now (no progress) keeps it: the next load
    // decides.
    clearHint:
      hint !== null &&
      !entry &&
      stored !== "paused" &&
      !(video.originalStatus === "uploading" && !progress),
  };
}
