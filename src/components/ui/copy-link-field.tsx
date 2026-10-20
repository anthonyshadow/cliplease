"use client";

import { Check, Copy, Share } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useClientValue } from "./use-client-value";

const PILL =
  "hit-44 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-transparent bg-surface px-4 text-callout font-semibold text-ink active:opacity-70";

/**
 * 04 §9.25: read-only row with the URL truncated at the start (the slug stays visible), a Copy pill and, when
 * the browser can share, "Share…". Copy → "Copied" + Check for 2 s and a polite "Link copied".
 * Without a clipboard the text is selected and the row says "Press and hold to copy".
 */
export function CopyLinkField({
  url,
  label,
  className,
}: {
  url: string;
  /** Visually hidden name read before the URL, e.g. "License link". */
  label: string;
  className?: string;
}) {
  // Read after hydration: Node also has a global `navigator`, so a check during render would differ between the server
  // and some browsers (a hydration mismatch).
  const canShare = useClientValue(
    () => typeof navigator.share === "function",
    false,
  );
  // "copied" for 2 s after a copy; "manual" when there is no clipboard and the text is selected instead. `id`
  // changes on every press, so a second copy restarts the 2 s and is announced again.
  const [status, setStatus] = useState<{
    kind: "idle" | "copied" | "manual";
    id: number;
  }>({ kind: "idle", id: 0 });
  const copied = status.kind === "copied";
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (status.kind !== "copied") return;
    const timer = setTimeout(
      () => setStatus((s) => ({ kind: "idle", id: s.id })),
      2000,
    );
    return () => clearTimeout(timer);
  }, [status]);

  const selectText = () => {
    const node = textRef.current;
    const selection = window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setStatus((s) => ({ kind: "copied", id: s.id + 1 }));
    } catch {
      selectText();
      setStatus((s) => ({ kind: "manual", id: s.id + 1 }));
    }
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex h-11 items-center gap-1 rounded-md bg-fill pr-1 pl-3.5">
        <span className="sr-only">{`${label}: `}</span>
        <span
          ref={textRef}
          className="min-w-0 flex-1 truncate text-callout text-ink tabular-nums [direction:rtl] select-all"
        >
          {/* The bidi isolate keeps the URL's own order while the start is the part that gets cut. */}
          <bdi dir="ltr">{url}</bdi>
        </span>
        <button type="button" onClick={copy} className={PILL}>
          {copied ? (
            <Check aria-hidden size={16} strokeWidth={2} />
          ) : (
            <Copy aria-hidden size={16} strokeWidth={2} />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
        {canShare ? (
          <button
            type="button"
            onClick={() => navigator.share({ url }).catch(() => {})}
            className={PILL}
          >
            <Share aria-hidden size={16} strokeWidth={2} />
            Share…
          </button>
        ) : null}
      </div>
      {/* Keyed by the press, so a repeated message is announced again. "Link copied" is for screen readers only. */}
      <p aria-live="polite" className="text-footnote text-ink-2">
        <span key={status.id} className={cn(copied && "sr-only")}>
          {copied ? "Link copied" : null}
          {status.kind === "manual" ? "Press and hold to copy" : null}
        </span>
      </p>
    </div>
  );
}
