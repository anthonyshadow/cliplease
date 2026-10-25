"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { COPY_LINK_COPY, useCopyLink } from "./use-copy-link";

const PILL =
  "hit-44 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-transparent bg-surface px-4 text-callout font-semibold text-ink active:opacity-70";

/**
 * 04 §9.25: read-only row with the URL truncated at the start (the slug stays visible) and a Copy pill. Copy → "Copied"
 * + Check for 2 s and a polite "Link copied". Without a clipboard the text is selected and the row says "Press and
 * hold to copy". "Share…" is its own button beside it where the browser can share (ShareButton; 05 §6.5 callout 55).
 */
export function CopyLinkField({
  url,
  label,
  className,
}: {
  url: string;
  /** Visually hidden name read before the URL, e.g. "Share link". */
  label: string;
  className?: string;
}) {
  const { status, copy } = useCopyLink(url);
  const copied = status.kind === "copied";
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (status.kind !== "manual") return;
    const node = textRef.current;
    const selection = window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [status]);

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
      </div>
      {/* Keyed by the press, so a repeated message is announced again. "Link copied" is for screen readers only. */}
      <p aria-live="polite" className="text-footnote text-ink-2">
        <span key={status.id} className={cn(copied && "sr-only")}>
          {copied ? COPY_LINK_COPY.copied : null}
          {status.kind === "manual" ? COPY_LINK_COPY.manual : null}
        </span>
      </p>
    </div>
  );
}
