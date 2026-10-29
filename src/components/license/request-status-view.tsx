"use client";

import { LoaderCircle } from "lucide-react";
import { type ReactNode, useState } from "react";
import { MESSAGE_COLUMN } from "@/components/layout/gutter";
import { useCheckingRefresh } from "@/components/layout/refreshing-message";
import { FocusedHeading } from "@/components/ui/focused-heading";
import { useViewerDeadline } from "@/components/ui/use-viewer-deadline";
import { type RequestView, VIEW_COPY } from "@/lib/licensing/request-status";
import { cn } from "@/lib/utils";

const HEADING = "text-title-1 text-ink wrap-anywhere";

/**
 * /r's title and body for `view` (01 §4.8; 05 §4.3), then `children` (the countdown, the summary card, the way back).
 * One component at one place for every view, so a refresh that brings a new status cross-fades the title and body
 * (250 ms) and moves the focus to the new title, back at the top (FocusedHeading, remounted with the title); the first
 * view, as the page loaded, neither fades nor takes the focus.
 * A deadline is formatted in the viewer's zone after mount: until then its sentence is left out (02 §4.4). "Finishing
 * checkout…" refreshes every 3 s with a spinner, and after 30 s says what to do instead.
 */
export function RequestStatusView({
  view,
  handle,
  total,
  expiresAt,
  children,
}: {
  view: RequestView;
  handle: string;
  /** formatMoney's total. */
  total: string;
  /** ISO 8601 instant. */
  expiresAt: string | null;
  children?: ReactNode;
}) {
  const copy = VIEW_COPY[view];
  const title = copy.title(handle);
  const [firstTitle] = useState(title);
  const changed = title !== firstTitle;
  const checked = useCheckingRefresh(view === "returning");
  const checking = view === "returning" && !checked;
  const deadline = useViewerDeadline(expiresAt);
  const heading = (
    <>
      {checking ? (
        <span aria-hidden className="mr-2 inline-flex align-middle">
          <LoaderCircle size={16} strokeWidth={2} className="animate-spin" />
        </span>
      ) : null}
      {title}
    </>
  );

  return (
    <div className={MESSAGE_COLUMN}>
      <div
        key={title}
        className={cn(
          "flex w-full flex-col items-start gap-4",
          changed && "animate-cross-fade",
        )}
      >
        {changed ? (
          <FocusedHeading className={HEADING}>{heading}</FocusedHeading>
        ) : (
          <h1 tabIndex={-1} className={HEADING}>
            {heading}
          </h1>
        )}
        {checking ? null : (
          <p className="text-body text-ink-2 wrap-anywhere">
            {copy.body({ handle, total, deadline })}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}
