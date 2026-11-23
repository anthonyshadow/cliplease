"use client";

import { useState } from "react";
import { adminDisableVideo } from "@/app/admin/actions";
import { Banner } from "@/components/ui/banner";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { toast } from "@/components/ui/toast";
import { usePendingAction } from "@/components/ui/use-pending-action";
import { DISABLE_COPY } from "@/lib/admin/copy";
import { VIDEO_DISABLED_REASONS } from "@/lib/domain/values";
import { VIDEO_DISABLED_REASON_LABELS } from "@/lib/videos/review";
import { ReasonNoteFields, useReasonField } from "./reason-note-fields";
import type { AdminVideoAction } from "./video-row-action";

/**
 * What the last sweep left waiting (owner answers Q-198 a, Q-202): the requests nothing can charge now, the captures,
 * and how many sweeps have left requests waiting (the warning's key).
 */
type Left = { stillOpen: number; capturing: number; attempt: number };

/** The still-open warning's words: the still-open line, then the capturing line, each when it counts any (Q-202). */
function warning({ stillOpen, capturing }: Left): string {
  return [
    stillOpen > 0 ? DISABLE_COPY.stillOpen(stillOpen) : null,
    capturing > 0 ? DISABLE_COPY.capturing(capturing) : null,
  ]
    .filter((line) => line !== null)
    .join(" ");
}

/**
 * The Disable sheet (05 §7 callout 6; design/P21-admin-view.md §6.8; owner answers Q-198 a, Q-199 a, Q-201–Q-203): the
 * body by the video's waiting requests, a reason to choose ("Choose a reason." until one is) and an optional note for
 * admins. While "Disabling…" runs it can't be closed. A failure shows the error Banner and keeps everything. Done with
 * nothing left waiting: closed, and the toast. A sweep that left requests waiting keeps it open, the reason and note
 * read-only, with the warning: the still-open line for the requests nothing can charge now, the capturing line for the
 * payments already going through (Q-202), both when both. With requests still open, the still-open body is the dialog's
 * description and the buttons are Close / Try again, which runs the sweep alone (`sweepOnly`) with the same reason and
 * note; with only captures left there is nothing to try again, so there is no description and Close is the one button
 * (it takes the focus). Each such sweep remounts the warning (keyed by `attempt`), so a Try again that leaves requests
 * waiting is announced again while the focus stays on Try again. A video no longer disabled (another admin's Enable)
 * closes the sheet with no toast: the refreshed row shows the truth.
 */
export function DisableVideoSheet({
  video,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  video: AdminVideoAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { field, note, showReasonError, chosen } = useReasonField(
    VIDEO_DISABLED_REASONS,
  );
  const [error, setError] = useState<string | null>(null);
  /** The waiting requests the last sweep left; null until a sweep leaves some (owner answers Q-198 a, Q-202). */
  const [left, setLeft] = useState<Left | null>(null);
  const [pending, run] = usePendingAction();
  // Ready: the body and Disable video. Requests still open: their body and Try again. Only captures left: nothing to try
  // again, so neither.
  let description: string | undefined = DISABLE_COPY.body(video.waitingCount);
  let confirmLabel: string | undefined = DISABLE_COPY.confirm;
  if (left) {
    const retryable = left.stillOpen > 0;
    description = retryable
      ? DISABLE_COPY.stillOpenBody(left.stillOpen)
      : undefined;
    confirmLabel = retryable ? DISABLE_COPY.tryAgain : undefined;
  }

  async function disable() {
    setError(null);
    const reason = chosen();
    if (reason === null) return;
    const fields = { videoId: video.id, reason, note };
    const result = await run(() =>
      adminDisableVideo(left ? { ...fields, sweepOnly: true } : fields),
    );
    // Null: Next is on its way to sign-in.
    if (result === null) return;
    if (!result.ok) {
      const reasonMessage = result.error.fields?.reason?.[0];
      if (reasonMessage) showReasonError(reasonMessage);
      else setError(result.error.message);
      return;
    }
    if (!result.data.disabled) {
      onOpenChange(false);
      return;
    }
    const { stillOpen, capturing } = result.data;
    if (stillOpen > 0 || capturing > 0) {
      setLeft((last) => ({
        stillOpen,
        capturing,
        attempt: (last?.attempt ?? 0) + 1,
      }));
      return;
    }
    toast(DISABLE_COPY.toast);
    onOpenChange(false);
  }

  return (
    <ConfirmSheet
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      title={DISABLE_COPY.title(video.title)}
      lead={
        left ? (
          <Banner key={left.attempt} tone="warning">
            {warning(left)}
          </Banner>
        ) : undefined
      }
      description={description}
      confirmLabel={confirmLabel}
      confirmVariant={left ? "primary" : "destructive"}
      confirmLoading={pending}
      confirmLoadingLabel={DISABLE_COPY.pending}
      onConfirm={(event) => {
        event.preventDefault();
        void disable();
      }}
      cancelLabel={left ? DISABLE_COPY.close : DISABLE_COPY.cancel}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <ReasonNoteFields
        field={field}
        labels={VIDEO_DISABLED_REASON_LABELS}
        error={error}
        locked={left !== null}
      />
    </ConfirmSheet>
  );
}
