// The File step's words and the pure rules behind them (04 §9.26, §11.10; 07 D80; owner answers Q-40, Q-42, Q-46,
// Q-47, Q-49). Client-safe.
import { formatBytes, formatDuration } from "../format";
import { GENERIC_ERROR_MESSAGE } from "../result";
import { SIGN_IN_COPY } from "../sign-in";
import { graphemes } from "../text/graphemes";
import { isBadFileCode, type UploadErrorCode } from "./codes";
import {
  mimeFromFileName,
  ORIGINAL_MAX_BYTES,
  ORIGINAL_MIME,
  type OriginalMime,
} from "./limits";

export type { UploadErrorCode } from "./codes";

/** The File step's lines around the drop area (the drop area's own words are in upload-dropzone.tsx). */
export const DROPZONE_COPY = {
  cancel: "Cancel",
  checking: "Checking the file…",
  attached: "Original attached",
  replace: "Replace",
  // Owner answer Q-42 follow-up: the upload carries on across the app's pages, not across a reload.
  keepOpen:
    "Keep this tab open until the upload finishes. You can use other pages meanwhile.",
  // Owner answer Q-40 a (proposed copy).
  interrupted: "Upload didn't finish. Choose the file again.",
  continueHelper: "Choose the original file to continue.",
  progressLabel: "Upload progress",
  // 04 §9.26 / §11.10 (07 D80).
  retrying: "Connection lost. Retrying…",
  iphoneHint: "On iPhone, choose the video from Files for full quality.",
  // Owner answer Q-49 b (proposed copy): the same video open in another tab.
  otherTab: "This video is uploading in another tab.",
} as const;

/** "Upload paused at 46%": the paused boxes, the live region and the floating card all say it. */
const pausedAt = (percent: number) => `Upload paused at ${percent}%`;

/** The paused, mismatch and expired boxes (04 §9.26, §11.10; owner answer Q-46 a: two Paused boxes). */
export const PAUSE_COPY = {
  /** Same tab: offline, or a part ran out of retries; it goes on by itself when the browser is back online. */
  pausedHere: (percent: number) =>
    `${pausedAt(percent)}. Check your connection.`,
  resume: "Resume",
  /** After a reload or a closed tab: the browser no longer holds the file. */
  pausedAfterReload: (percent: number) =>
    `${pausedAt(percent)}. Choose the same file to continue.`,
  chooseFile: "Choose file",
  mismatch: "This doesn't look like the same file. Start again?",
  startAgain: "Start again",
  chooseAnother: "Choose another file",
  /** The live region's word for a pause (owner answer Q-47 a). */
  pausedSpoken: (percent: number) => `${pausedAt(percent)}.`,
} as const;

export const COVER_COPY = {
  label: "Cover image",
  change: "Use a different image",
  choose: "Choose an image",
  cantPreview:
    "We can't preview this format in your browser. Your file is fine. Add a cover image for buyers.",
  // Owner answer Q-40 a (proposed copy).
  missing: "Add a cover image for buyers.",
  badType: "Choose a JPEG, PNG or WebP image.",
  tooLarge: "This image is too large. Choose a smaller one.",
} as const;

/** The floating upload card on the app's other pages (owner answer Q-42 and its follow-up; proposed copy). */
export const INDICATOR_COPY = {
  uploading: (title: string) => `Uploading ${title}`,
  // Owner answer Q-47 a.
  paused: pausedAt,
  done: "Upload complete",
  stopped: "Upload didn't finish",
  open: "Open",
  dismiss: "Dismiss",
} as const;

const ERROR_LINES = {
  badFile:
    "We couldn't read this file as a video. Export it again as MP4 and retry.",
  badType: "Upload an MP4 or MOV video.",
  expired: "This upload expired. Start again.",
  signedOut: "You've been signed out. Sign in again to continue.",
} as const;

/** "This file is 2.4 GB. The limit is 2 GB." A size just over the limit never reads as the limit itself ("2.1 GB"). */
export function tooLargeMessage(size: number): string {
  const limit = formatBytes(ORIGINAL_MAX_BYTES);
  let shown = formatBytes(size);
  if (size > ORIGINAL_MAX_BYTES && shown === limit) {
    shown = `${(Math.ceil((size / 1024 ** 3) * 10) / 10).toFixed(1)} GB`;
  }
  return `This file is ${shown}. The limit is ${limit}.`;
}

/**
 * The browser's check before any request (07 D80): an MP4 or MOV (the type from `file.type`, else from the name, for
 * iPhone files with an empty type) of 1 byte to 2 GB.
 */
export function checkOriginalFile(file: {
  name: string;
  type: string;
  size: number;
}): { ok: true; contentType: OriginalMime } | { ok: false; message: string } {
  const contentType =
    file.type === ""
      ? mimeFromFileName(file.name)
      : (ORIGINAL_MIME.find((mime) => mime === file.type) ?? null);
  if (contentType === null) return { ok: false, message: ERROR_LINES.badType };
  if (file.size > ORIGINAL_MAX_BYTES) {
    return { ok: false, message: tooLargeMessage(file.size) };
  }
  if (file.size < 1) return { ok: false, message: ERROR_LINES.badFile };
  return { ok: true, contentType };
}

/** Whole percent sent, never above 100 and never 100 before every byte is in. */
export function uploadPercent(sent: number, total: number): number {
  if (total <= 0) return 0;
  return sent >= total ? 100 : Math.min(99, Math.floor((sent / total) * 100));
}

/** The percent a paused upload shows: never 100 before the upload is complete. */
export const pausedPercent = (sent: number, total: number) =>
  Math.min(99, uploadPercent(sent, total));

/** A row's line under its bar: the percent, then the bytes in (never past the file). */
function barLabel(percent: number, sent: number, total: number): string {
  return `${percent}% · ${formatBytes(Math.min(sent, total), total)}`;
}

/** "37% · 312 of 840 MB" (04 §9.26); "1.2 of 2 GB" above 1 GB. */
export function progressLabel(sent: number, total: number): string {
  return barLabel(uploadPercent(sent, total), sent, total);
}

/** A paused row's line: the paused percent (never 100) and the bytes stored, "46% · 386 of 840 MB". */
export function pausedLabel(sent: number, total: number): string {
  return barLabel(pausedPercent(sent, total), sent, total);
}

const MILESTONES = [25, 50, 75] as const;

/** The live region's words when the percent crosses 25, 50 or 75 (the highest one crossed), or null. */
export function milestoneAnnouncement(
  before: number,
  after: number,
): string | null {
  const crossed = MILESTONES.filter((m) => before < m && after >= m).at(-1);
  return crossed === undefined ? null : `${crossed}% uploaded`;
}

/** A failed original's line and its button: "pick" opens the file picker, "retry" starts again with the same file. */
export type UploadErrorLine = {
  message: string;
  action: { kind: "pick" | "retry" | "sign_in"; label: string } | null;
};

export const TRY_AGAIN = "Try again";

const BAD_FILE_LINE: UploadErrorLine = {
  message: ERROR_LINES.badFile,
  action: { kind: "pick", label: TRY_AGAIN },
};

/**
 * What the File step shows for a failed original (04 §11.10, 07 D80). Cancel shows nothing; too large and the wrong
 * type stay under the empty drop area with no button (05 States); everything unexpected is the generic line.
 */
export function uploadErrorLine(
  code: UploadErrorCode,
  { size, online }: { size: number; online: boolean },
): UploadErrorLine | null {
  if (isBadFileCode(code)) return BAD_FILE_LINE;
  switch (code) {
    case "canceled":
    case "paused":
      return null;
    case "stale_upload":
      return {
        message: DROPZONE_COPY.interrupted,
        action: { kind: "pick", label: TRY_AGAIN },
      };
    case "too_large":
      return { message: tooLargeMessage(size), action: null };
    case "bad_type":
      return { message: ERROR_LINES.badType, action: null };
    case "upload_expired":
      return {
        message: ERROR_LINES.expired,
        action: { kind: "retry", label: "Start again" },
      };
    case "unauthorized":
      return {
        message: ERROR_LINES.signedOut,
        action: { kind: "sign_in", label: "Sign in" },
      };
    default:
      return {
        message: online ? GENERIC_ERROR_MESSAGE : SIGN_IN_COPY.offline,
        action: { kind: "retry", label: TRY_AGAIN },
      };
  }
}

/** The line a stored failure shows when the File step loads (`original_error`, P10a); the file is no longer in hand. */
export function storedFailureLine(
  originalError: string | null,
): UploadErrorLine {
  return originalError === "upload_expired"
    ? {
        message: ERROR_LINES.expired,
        action: { kind: "pick", label: "Start again" },
      }
    : BAD_FILE_LINE;
}

/**
 * A file name cut in the middle (04 §9.26): the head truncates with CSS, the tail (extension included) always shows.
 * Counted in characters (../text/graphemes), never cutting one in two.
 */
export function splitFileName(name: string, tail = 8): [string, string] {
  // No more UTF-16 units than the two halves hold means no more characters either: nothing to segment.
  if (name.length <= tail * 2) return [name, ""];
  const chars = graphemes(name);
  if (chars.length <= tail * 2) return [name, ""];
  return [chars.slice(0, -tail).join(""), chars.slice(-tail).join("")];
}

/** "Original attached · 0:14 · 720 × 1280", leaving out what the browser couldn't read. */
export function attachedLine(hints: {
  duration: string | null;
  width: number | null;
  height: number | null;
}): string {
  const parts: string[] = [DROPZONE_COPY.attached];
  if (hints.duration) parts.push(hints.duration);
  if (hints.width && hints.height)
    parts.push(`${hints.width} × ${hints.height}`);
  return parts.join(" · ");
}

/** attachedLine from the stored file's (or the browser's read of it) length and size: the File step and Where posted. */
export function hintsLine(h: {
  durationMs: number | null;
  width: number | null;
  height: number | null;
}): string {
  return attachedLine({
    duration: h.durationMs ? formatDuration(h.durationMs / 1000) : null,
    width: h.width,
    height: h.height,
  });
}
