"use client";

import { Check, CircleAlert, Upload, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  DROPZONE_COPY,
  INDICATOR_COPY,
  uploadPercent,
} from "@/lib/upload/messages";
import {
  isRunning,
  markOriginalSeen,
  type OriginalEntry,
  useUploads,
} from "@/lib/upload/upload-store";
import { cn } from "@/lib/utils";
import { videoStepHref } from "@/lib/videos/steps";

// Above the TabBar below lg (--bar-offset), the bottom-right corner from md (owner answer Q-42 follow-up a). Toasts
// stack above it (globals.css).
const STACK =
  "fixed bottom-[calc(1rem+env(safe-area-inset-bottom)+var(--bar-offset,0px))] left-[max(var(--gutter),env(safe-area-inset-left))] right-[max(var(--gutter),env(safe-area-inset-right))] z-50 flex flex-col gap-2 md:left-auto md:w-88";

function UploadCard({ entry }: { entry: OriginalEntry }) {
  const running = isRunning(entry.phase);
  const Icon =
    entry.phase === "done"
      ? Check
      : entry.phase === "error"
        ? CircleAlert
        : Upload;
  const heading =
    entry.phase === "uploading"
      ? INDICATOR_COPY.uploading(entry.title)
      : entry.phase === "checking"
        ? DROPZONE_COPY.checking
        : entry.phase === "done"
          ? INDICATOR_COPY.done
          : INDICATOR_COPY.stopped;
  const percent =
    entry.phase === "checking" ? 100 : uploadPercent(entry.sent, entry.size);
  const open = (
    <Button asChild variant="link" size="sm" className="shrink-0">
      <Link href={videoStepHref(entry.videoId, "file")} prefetch={false}>
        {INDICATOR_COPY.open}
      </Link>
    </Button>
  );
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface p-3 shadow-overlay">
      <div className="flex items-center gap-2">
        <Icon
          aria-hidden
          size={16}
          strokeWidth={2}
          className={cn(
            "shrink-0 self-start",
            running ? "mt-0.5" : "mt-1",
            entry.phase === "error" ? "text-danger-text" : "text-ink",
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-callout font-semibold text-ink">
            {heading}
          </p>
          {running ? null : (
            <p className="truncate text-footnote text-ink-2">{entry.title}</p>
          )}
        </div>
        {running ? null : (
          <>
            {open}
            <Button
              size="icon"
              aria-label={INDICATOR_COPY.dismiss}
              className="hit-44 size-8 bg-transparent"
              onClick={() => dismiss(entry.videoId)}
            >
              <X aria-hidden size={16} strokeWidth={2} />
            </Button>
          </>
        )}
      </div>
      {running ? (
        <div className="flex items-center gap-3">
          <Progress
            value={percent}
            label={INDICATOR_COPY.uploading(entry.title)}
            className="flex-1"
          />
          <span className="text-footnote text-ink-2 tabular-nums">{`${percent}%`}</span>
          {open}
        </div>
      ) : null}
    </li>
  );
}

/** ×: the card goes, and focus moves to the next card's Open, or to the page. */
function dismiss(videoId: string) {
  markOriginalSeen(videoId);
  requestAnimationFrame(() => {
    const next = document.querySelector<HTMLElement>("[data-upload-card] a");
    if (next) {
      next.focus();
      return;
    }
    const main = document.querySelector("main");
    if (main) {
      main.tabIndex = -1;
      main.focus({ preventScroll: true });
    }
  });
}

/**
 * The floating upload card (owner answer Q-42): while an original uploads and the creator is on another page of the
 * app, a card shows its progress; when it ends it says so until dismissed or seen, and Open goes back to its File step.
 * Hidden on that video's own page, where the dropzone shows the same upload. Screen readers hear the ending only.
 */
export function UploadIndicator() {
  const pathname = usePathname();
  const { originals } = useUploads();
  // Cancel marks its entry seen, like the File step showing how one ended.
  const shown = Object.values(originals).filter(
    (e) => !e.seen && pathname !== `/dashboard/videos/${e.videoId}`,
  );
  const visible = shown.length > 0;
  const ended = shown.filter((e) => e.phase === "done" || e.phase === "error");
  const last = ended.at(-1);
  const ending = last
    ? `${last.phase === "done" ? INDICATOR_COPY.done : INDICATOR_COPY.stopped}: ${last.title}`
    : "";
  const [said, setSaid] = useState("");
  useEffect(() => {
    if (ending) setSaid(ending);
  }, [ending]);

  // The card's height, for the page room under it, focus scrolling and the toasts above it (globals.css).
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const node = list.current;
    if (!visible || !node) return;
    const root = document.documentElement;
    const measure = () =>
      root.style.setProperty("--upload-card-h", `${node.offsetHeight}px`);
    // Now, and again whenever the card changes size (a background tab delivers no resize callbacks until shown).
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--upload-card-h");
    };
  }, [visible]);
  return (
    <>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
      {visible ? (
        <>
          {/* Room under the page so its last lines can scroll above the card. */}
          <div
            aria-hidden
            className="h-[calc(var(--upload-card-h,0px)+1rem)]"
          />
          <ul ref={list} data-upload-card data-covers-focus className={STACK}>
            {shown.map((entry) => (
              <UploadCard key={entry.videoId} entry={entry} />
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
