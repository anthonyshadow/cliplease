import { describe, expect, it } from "vitest";
import {
  deriveFileStep,
  type FileStepBox,
  type FileStepInput,
} from "./file-step-state";
import type { UploadErrorLine } from "./messages";
import type { OriginalUploadProgress, ResumeHint } from "./resume";

const MIB = 1024 ** 2;
const SIZE = 40 * MIB;
const STORED_NAME = "stored.mov";
const HINT: ResumeHint = {
  uploadId: "upload-1",
  name: "IMG_0001.MOV",
  size: SIZE,
  lastModified: 1_760_000_000_000,
};
const resumable = (uploadId = HINT.uploadId): OriginalUploadProgress => ({
  state: "resumable",
  uploadId,
  size: SIZE,
  doneBytes: 32 * MIB,
});
const expired: OriginalUploadProgress = { state: "expired" };

const BASE: FileStepInput = {
  entry: null,
  video: {
    originalStatus: "none",
    originalError: null,
    originalFilename: null,
    posterSrc: null,
  },
  progress: null,
  hint: null,
  cancelledHere: false,
  mismatchHeld: false,
  problem: false,
  otherTab: false,
  tabCover: false,
  online: true,
};

type Entry = NonNullable<FileStepInput["entry"]>;
const entry = (phase: Entry["phase"], more: Partial<Entry> = {}): Entry => ({
  phase,
  pausedBy: null,
  fileName: "clip.mp4",
  size: SIZE,
  sent: 10 * MIB,
  error: null,
  ...more,
});

type Video = FileStepInput["video"];
const stored = (
  originalStatus: Video["originalStatus"],
  more: Partial<Video> = {},
): Video => ({ ...BASE.video, originalStatus, ...more });
const uploading = stored("uploading", { originalFilename: STORED_NAME });

const derive = (input: Partial<FileStepInput>) =>
  deriveFileStep({ ...BASE, ...input });

const reloadRow = (fileName: string) => ({
  fileName,
  sent: 32 * MIB,
  total: SIZE,
});
const BAD_FILE: UploadErrorLine = {
  message:
    "We couldn't read this file as a video. Export it again as MP4 and retry.",
  action: { kind: "pick", label: "Try again" },
};
const EXPIRED: UploadErrorLine = {
  message: "This upload expired. Start again.",
  action: { kind: "pick", label: "Start again" },
};
const retry = (message: string): UploadErrorLine => ({
  message,
  action: { kind: "retry", label: "Try again" },
});

describe("deriveFileStep: the box (04 §9.26, P10c)", () => {
  it.each<[string, Partial<FileStepInput>, FileStepBox]>([
    ["nothing anywhere", {}, { kind: "rest" }],
    ["stored ready", { video: stored("ready") }, { kind: "done" }],
    [
      "stored ready with a stale hint",
      { video: stored("ready"), hint: HINT },
      { kind: "done" },
    ],
    ["this tab's upload done", { entry: entry("done") }, { kind: "done" }],
    [
      "this tab's upload, not the stored ready",
      { entry: entry("uploading"), video: stored("ready") },
      {
        kind: "uploading",
        fileName: "clip.mp4",
        sent: 10 * MIB,
        total: SIZE,
        retrying: false,
      },
    ],
    [
      "a Cancel here hides the stored ready",
      { video: stored("ready"), cancelledHere: true },
      { kind: "rest" },
    ],
    [
      "a Cancel here hides the paused upload",
      {
        video: uploading,
        progress: resumable(),
        hint: HINT,
        cancelledHere: true,
      },
      { kind: "rest" },
    ],

    // Mismatch: after done, before everything else.
    [
      "done before a held mismatch",
      { entry: entry("done"), mismatchHeld: true },
      { kind: "done" },
    ],
    [
      "a held mismatch over the paused upload",
      {
        video: uploading,
        progress: resumable(),
        hint: HINT,
        mismatchHeld: true,
      },
      { kind: "mismatch", row: reloadRow(HINT.name) },
    ],
    [
      "a held mismatch with nothing the server can resume",
      { video: uploading, mismatchHeld: true },
      { kind: "mismatch", row: null },
    ],
    [
      "this tab's upload ended not_same_file",
      { entry: entry("error", { error: "not_same_file" }) },
      { kind: "mismatch", row: null },
    ],
    [
      "a held mismatch before this tab's upload",
      { entry: entry("retrying"), mismatchHeld: true },
      { kind: "mismatch", row: null },
    ],
    [
      "a held mismatch before a stored failure",
      { video: stored("failed"), mismatchHeld: true },
      { kind: "mismatch", row: null },
    ],

    // This tab's upload.
    [
      "uploading",
      { entry: entry("uploading") },
      {
        kind: "uploading",
        fileName: "clip.mp4",
        sent: 10 * MIB,
        total: SIZE,
        retrying: false,
      },
    ],
    [
      "retrying",
      { entry: entry("retrying") },
      {
        kind: "uploading",
        fileName: "clip.mp4",
        sent: 10 * MIB,
        total: SIZE,
        retrying: true,
      },
    ],
    [
      "checking",
      { entry: entry("checking") },
      { kind: "checking", fileName: "clip.mp4" },
    ],
    [
      "paused offline",
      { entry: entry("paused", { pausedBy: "offline", sent: SIZE }) },
      {
        kind: "paused_here",
        pausedBy: "offline",
        percent: 99,
        row: { fileName: "clip.mp4", sent: SIZE, total: SIZE },
      },
    ],
    [
      "paused here before the server's paused upload",
      {
        entry: entry("paused", { pausedBy: "retries" }),
        video: uploading,
        progress: resumable(),
        hint: HINT,
      },
      {
        kind: "paused_here",
        pausedBy: "retries",
        percent: 25,
        row: { fileName: "clip.mp4", sent: 10 * MIB, total: SIZE },
      },
    ],
    [
      "this tab's failure",
      { entry: entry("error", { error: "internal" }) },
      {
        kind: "error",
        fileName: "clip.mp4",
        line: retry("Something went wrong. Try again."),
      },
    ],
    [
      "this tab's failure offline",
      { entry: entry("error", { error: "network" }), online: false },
      {
        kind: "error",
        fileName: "clip.mp4",
        line: retry("You're offline. Check your connection and try again."),
      },
    ],
    [
      "this tab's failure with no code",
      { entry: entry("error") },
      {
        kind: "error",
        fileName: "clip.mp4",
        line: retry("Something went wrong. Try again."),
      },
    ],
    [
      "this tab's failure under a file check's problem",
      { entry: entry("error", { error: "internal" }), problem: true },
      { kind: "rest" },
    ],
    [
      "this tab's failure that shows nothing (paused)",
      { entry: entry("error", { error: "paused" }) },
      { kind: "rest" },
    ],
    [
      "this tab's Cancel, before the stored state",
      { entry: entry("canceled"), video: stored("failed") },
      { kind: "rest" },
    ],

    // What the server stored, with no upload in this tab.
    [
      "stored paused, this device's hint",
      { video: uploading, progress: resumable(), hint: HINT },
      { kind: "paused_reload", percent: 80, row: reloadRow(HINT.name) },
    ],
    [
      "stored paused, a hint with no name",
      {
        video: uploading,
        progress: resumable(),
        hint: { ...HINT, name: "" },
      },
      { kind: "paused_reload", percent: 80, row: reloadRow(STORED_NAME) },
    ],
    [
      "stored paused before the hint is read",
      { video: uploading, progress: resumable(), hint: "unread" },
      { kind: "paused_reload", percent: 80, row: reloadRow(STORED_NAME) },
    ],
    [
      "stored uploading, another upload's hint",
      { video: uploading, progress: resumable("upload-2"), hint: HINT },
      { kind: "not_finished" },
    ],
    [
      "stored uploading, no hint",
      { video: uploading, progress: resumable() },
      { kind: "not_finished" },
    ],
    [
      "stored uploading, progress unknown",
      { video: uploading, hint: HINT },
      { kind: "not_finished" },
    ],
    [
      "stored uploading, progress unknown, before the hint is read",
      { video: uploading, hint: "unread" },
      { kind: "not_finished" },
    ],
    [
      "stored uploading, a file check's problem",
      { video: uploading, problem: true },
      { kind: "not_finished" },
    ],
    [
      "stored uploading, expired",
      { video: uploading, progress: expired, hint: HINT },
      { kind: "error", fileName: STORED_NAME, line: EXPIRED },
    ],
    [
      "stored uploading, expired, no hint on this device",
      { video: uploading, progress: expired },
      { kind: "error", fileName: STORED_NAME, line: EXPIRED },
    ],
    [
      "stored uploading, expired, before the hint is read",
      { video: uploading, progress: expired, hint: "unread" },
      { kind: "error", fileName: STORED_NAME, line: EXPIRED },
    ],
    [
      "stored failed, upload_expired",
      {
        video: stored("failed", {
          originalError: "upload_expired",
          originalFilename: STORED_NAME,
        }),
      },
      { kind: "error", fileName: STORED_NAME, line: EXPIRED },
    ],
    [
      "stored failed, size_mismatch",
      { video: stored("failed", { originalError: "size_mismatch" }) },
      { kind: "error", fileName: null, line: BAD_FILE },
    ],
    [
      "stored failed, no error",
      { video: stored("failed") },
      { kind: "error", fileName: null, line: BAD_FILE },
    ],
    [
      "stored failure under a file check's problem",
      { video: stored("failed"), problem: true },
      { kind: "rest" },
    ],
    ["stored none with a stale hint", { hint: HINT }, { kind: "rest" }],
  ])("%s", (_name, input, box) => {
    expect(derive(input).box).toEqual(box);
  });
});

describe("deriveFileStep: running", () => {
  it.each<[Entry["phase"] | null, boolean]>([
    ["uploading", true],
    ["retrying", true],
    ["checking", true],
    ["paused", false],
    ["done", false],
    ["error", false],
    ["canceled", false],
    [null, false],
  ])("%s → %s", (phase, running) => {
    expect(derive({ entry: phase && entry(phase) }).running).toBe(running);
  });
});

describe("deriveFileStep: elsewhere (owner answer Q-49)", () => {
  it.each<[string, boolean, Partial<FileStepInput>]>([
    ["another tab, none here", true, { otherTab: true }],
    [
      "another tab, this tab uploading",
      false,
      { otherTab: true, entry: entry("uploading") },
    ],
    [
      "another tab, this tab paused",
      false,
      { otherTab: true, entry: entry("paused") },
    ],
    [
      "another tab, this tab done",
      true,
      { otherTab: true, entry: entry("done") },
    ],
    [
      "another tab, this tab failed",
      true,
      { otherTab: true, entry: entry("error") },
    ],
    [
      "another tab, this tab cancelled",
      true,
      { otherTab: true, entry: entry("canceled") },
    ],
    ["no other tab", false, { entry: entry("done") }],
  ])("%s → %s", (_name, elsewhere, input) => {
    expect(derive(input).elsewhere).toBe(elsewhere);
  });
});

describe("deriveFileStep: showCover (owner answer Q-41)", () => {
  it.each<[string, boolean, Partial<FileStepInput>]>([
    ["nothing", false, {}],
    ["this tab uploading", true, { entry: entry("uploading") }],
    ["this tab cancelled", false, { entry: entry("canceled") }],
    ["stored ready", true, { video: stored("ready") }],
    ["a stored cover", true, { video: stored("none", { posterSrc: "/p" }) }],
    ["a cover in this tab", true, { tabCover: true }],
    [
      "this tab's file unreadable",
      false,
      { entry: entry("error", { error: "size_mismatch" }), tabCover: true },
    ],
    [
      "this tab's other failure",
      true,
      { entry: entry("error", { error: "internal" }) },
    ],
    [
      "a stored unreadable file",
      false,
      { video: stored("failed", { posterSrc: "/p" }) },
    ],
    [
      "a stored expiry",
      true,
      {
        video: stored("failed", {
          originalError: "upload_expired",
          posterSrc: "/p",
        }),
      },
    ],
    [
      "a stored unreadable file after a Cancel here",
      true,
      { video: stored("failed", { posterSrc: "/p" }), cancelledHere: true },
    ],
    [
      "this tab's unreadable file over a stored ready",
      false,
      {
        entry: entry("error", { error: "bad_signature_bytes" }),
        video: stored("ready"),
      },
    ],
    ["another tab's upload", false, { video: stored("ready"), otherTab: true }],
  ])("%s → %s", (_name, showCover, input) => {
    expect(derive(input).showCover).toBe(showCover);
  });
});

describe("deriveFileStep: clearHint (07 D103)", () => {
  it.each<[string, string | null, Partial<FileStepInput>]>([
    ["stored none", HINT.uploadId, { hint: HINT }],
    ["stored ready", HINT.uploadId, { hint: HINT, video: stored("ready") }],
    ["stored failed", HINT.uploadId, { hint: HINT, video: stored("failed") }],
    [
      "stored expired",
      HINT.uploadId,
      { hint: HINT, video: uploading, progress: expired },
    ],
    [
      "another upload's hint",
      HINT.uploadId,
      { hint: HINT, video: uploading, progress: resumable("upload-2") },
    ],
    [
      "the paused upload's hint",
      null,
      { hint: HINT, video: uploading, progress: resumable() },
    ],
    ["progress unknown", null, { hint: HINT, video: uploading }],
    ["an upload in this tab", null, { hint: HINT, entry: entry("done") }],
    [
      "another tab uploads the video",
      null,
      {
        hint: HINT,
        video: uploading,
        progress: resumable("upload-2"),
        otherTab: true,
      },
    ],
    [
      "a Cancel here",
      HINT.uploadId,
      {
        hint: HINT,
        video: uploading,
        progress: resumable(),
        cancelledHere: true,
      },
    ],
    ["no hint", null, { video: stored("ready") }],
    [
      "before the hint is read",
      null,
      { hint: "unread", video: stored("ready") },
    ],
  ])("%s → %s", (_name, clearHint, input) => {
    expect(derive(input).clearHint).toBe(clearHint);
  });
});
