"use client";

import { Check, LoaderCircle, Upload } from "lucide-react";
import {
  type DragEvent,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useRefocusOnSwap } from "@/components/ui/use-refocus-on-swap";
import { ORIGINAL_MIME } from "@/lib/upload/limits";
import {
  DROPZONE_COPY,
  pausedLabel,
  pausedPercent,
  progressLabel,
  splitFileName,
  uploadPercent,
} from "@/lib/upload/messages";
import { cn } from "@/lib/utils";

const ACCEPT = ORIGINAL_MIME.join(",");

// The drop area at rest (04 §9.26; 07 D80: up to 2 GB).
const DROP_AREA = {
  title: "Drop the original file here",
  sub: "MP4 or MOV, no watermark, up to 2 GB",
  choose: "Choose file",
  dragOver: "Drop to upload",
} as const;

export type DropzoneView =
  /** At rest: the drop area. */
  | { kind: "rest" }
  /** `retrying`: a part waits to try again; the bar holds and Cancel stays (one row, so focus never moves). */
  | {
      kind: "uploading";
      fileName: string;
      sent: number;
      total: number;
      retrying: boolean;
      onCancel: () => void;
    }
  /** Paused: the bar frozen where the upload stopped; the notice above holds the actions. */
  | { kind: "paused"; fileName: string; sent: number; total: number }
  | { kind: "checking"; fileName: string }
  /** `canReplace` false while the original is locked (07 D09): no Replace. */
  | { kind: "done"; line: string; canReplace: boolean }
  | {
      kind: "error";
      fileName: string | null;
      message: string;
      /** A link with `href`, the caller's button with `onClick`, else the button opens the file picker. */
      action: { label: string; onClick?: () => void; href?: string } | null;
    };

/** A middle-truncated file name (04 §9.26): the head ellipsizes, the tail (with the extension) always shows. */
function FileName({ name }: { name: string }) {
  const [head, tail] = splitFileName(name);
  return (
    <p
      title={name}
      className="flex min-w-0 text-callout font-semibold text-ink"
    >
      <span className="truncate">{head}</span>
      <span className="shrink-0">{tail}</span>
    </p>
  );
}

const ROW =
  "flex flex-col gap-2 rounded-lg border border-hairline bg-surface p-4";

/** The file's row in every state but rest: it takes focus when the state has no control of its own. */
function Row({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div tabIndex={-1} data-focus-row className={cn(ROW, className)}>
      {children}
    </div>
  );
}

// Where focus goes in a new state, in order of preference.
const FOCUS_ORDER = [
  "[data-focus-target]",
  "button, a[href]",
  "[data-focus-row]",
];

/**
 * UploadDropzone (04 §9.26): a <label> for a hidden file input, so a tap, Enter or a drop picks the original. The other
 * states replace the drop area with the file's row: uploading (bar, "37% · 312 of 840 MB", Cancel), checking (full
 * static bar), done (Replace when the original can change) and error (a danger line; the bar never turns red).
 */
export function UploadDropzone({
  view,
  onFile,
  notice,
  noticeKey = "",
  describedBy,
}: {
  view: DropzoneView;
  onFile: (file: File) => void;
  /**
   * A Banner above the drop area or row (paused, mismatch, didn't finish), given this dropzone's "open the file picker"
   * for its Choose file: its main action carries data-focus-target.
   */
  notice?: (pick: () => void) => ReactNode;
  /** Changes with the notice, so focus follows a notice's new controls too. */
  noticeKey?: string;
  /** Lines elsewhere that explain the drop area (the "Upload didn't finish" banner). */
  describedBy?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragDepth, setDragDepth] = useState(0);
  // Each state swaps the controls: focus that fell to the page goes to the new state's control (its own target, else
  // its first button or link, else the row itself).
  const refocus = useRefocusOnSwap<HTMLDivElement>(
    `${view.kind}|${noticeKey}`,
    FOCUS_ORDER,
  );
  const pick = () => input.current?.click();

  const picker = (
    <input
      ref={input}
      type="file"
      accept={ACCEPT}
      className="sr-only"
      // Only the drop area at rest is the input's own control; elsewhere Replace and Try again open it.
      tabIndex={view.kind === "rest" ? undefined : -1}
      aria-hidden={view.kind === "rest" ? undefined : true}
      data-focus-target={view.kind === "rest" ? "" : undefined}
      aria-describedby={describedBy}
      onChange={(event) => {
        const file = event.target.files?.[0];
        // Cleared, so choosing the same file again still fires a change.
        event.target.value = "";
        if (file) onFile(file);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        // WebKit opens a focused file input only on Space: Enter does the same everywhere.
        if (event.key === "Enter") {
          event.preventDefault();
          pick();
        }
      }}
    />
  );

  let body: ReactNode;
  if (view.kind === "rest") {
    const over = dragDepth > 0;
    body = (
      // biome-ignore lint/a11y/noLabelWithoutControl: the file input (`picker`) is rendered inside.
      <label
        data-focus-within
        data-dropzone
        onDragEnter={(event: DragEvent) => {
          event.preventDefault();
          setDragDepth((d) => d + 1);
        }}
        onDragOver={(event: DragEvent) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => setDragDepth((d) => Math.max(0, d - 1))}
        onDrop={(event: DragEvent) => {
          event.preventDefault();
          setDragDepth(0);
          const file = event.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        className={cn(
          "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg bg-surface p-6 text-center md:min-h-50",
          over
            ? "border-2 border-solid border-ink bg-fill"
            : "border-[1.5px] border-dashed border-hairline-strong",
        )}
      >
        {picker}
        <Upload
          aria-hidden
          size={24}
          strokeWidth={1.5}
          className="text-ink-2"
        />
        <span className="text-body font-semibold text-ink">
          {over ? DROP_AREA.dragOver : DROP_AREA.title}
        </span>
        <span className="text-footnote text-ink-2">{DROP_AREA.sub}</span>
        {/* Looks like a secondary sm button; the whole label is the control. */}
        <span
          aria-hidden
          className="mt-2 inline-flex h-9 items-center rounded-full border border-hairline-strong px-4 text-callout font-semibold text-ink"
        >
          {DROP_AREA.choose}
        </span>
      </label>
    );
  } else if (view.kind === "uploading" || view.kind === "checking") {
    const checking = view.kind === "checking";
    body = (
      <Row>
        <FileName name={view.fileName} />
        <Progress
          value={checking ? 100 : uploadPercent(view.sent, view.total)}
          label={DROPZONE_COPY.progressLabel}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-footnote text-ink-2 tabular-nums">
            {checking
              ? DROPZONE_COPY.checking
              : progressLabel(view.sent, view.total)}
          </p>
          {checking ? null : (
            <Button variant="tertiary" size="sm" onClick={view.onCancel}>
              {DROPZONE_COPY.cancel}
            </Button>
          )}
        </div>
        {view.kind === "uploading" && view.retrying ? (
          <p className="flex items-center gap-2 text-footnote text-ink-2">
            <LoaderCircle
              aria-hidden
              size={16}
              strokeWidth={2}
              className="shrink-0 animate-spin"
            />
            {DROPZONE_COPY.retrying}
          </p>
        ) : null}
      </Row>
    );
  } else if (view.kind === "paused") {
    body = (
      <Row>
        {picker}
        <FileName name={view.fileName} />
        <Progress
          value={pausedPercent(view.sent, view.total)}
          label={DROPZONE_COPY.progressLabel}
        />
        <p className="text-footnote text-ink-2 tabular-nums">
          {pausedLabel(view.sent, view.total)}
        </p>
      </Row>
    );
  } else if (view.kind === "done") {
    body = (
      <Row className="flex-row items-center justify-between gap-3">
        {picker}
        <p className="flex items-center gap-2 text-callout text-ink">
          <Check
            aria-hidden
            size={16}
            strokeWidth={2}
            className="shrink-0 text-ink"
          />
          {view.line}
        </p>
        {view.canReplace ? (
          <Button variant="tertiary" size="sm" onClick={pick}>
            {DROPZONE_COPY.replace}
          </Button>
        ) : null}
      </Row>
    );
  } else {
    const { action } = view;
    body = (
      <Row>
        {picker}
        {view.fileName ? <FileName name={view.fileName} /> : null}
        <p role="alert" className="text-footnote text-danger-text">
          {view.message}
        </p>
        {action ? (
          <Button
            asChild={action.href !== undefined}
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={
              action.href === undefined ? (action.onClick ?? pick) : undefined
            }
          >
            {action.href === undefined ? (
              action.label
            ) : (
              <a href={action.href}>{action.label}</a>
            )}
          </Button>
        ) : null}
      </Row>
    );
  }

  return (
    <div {...refocus} className="flex flex-col gap-3">
      {/* Keyed per state: a box's buttons never turn into another box's under the focus. */}
      {notice ? <Fragment key={noticeKey}>{notice(pick)}</Fragment> : null}
      {body}
    </div>
  );
}
