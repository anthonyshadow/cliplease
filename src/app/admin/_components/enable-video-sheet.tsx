"use client";

import { useState } from "react";
import { adminEnableVideo } from "@/app/admin/actions";
import { Banner } from "@/components/ui/banner";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { toast } from "@/components/ui/toast";
import { usePendingAction } from "@/components/ui/use-pending-action";
import { ENABLE_COPY } from "@/lib/admin/copy";
import type { AdminVideoAction } from "./video-row-action";

/**
 * The Enable sheet (design/P21-admin-view.md §6.9; owner answer Q-199 a): back to Off, with a primary confirm (it
 * takes nothing away). While "Enabling…" runs it can't be closed; a failure shows the error Banner; done: closed, and
 * the toast.
 */
export function EnableVideoSheet({
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
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = usePendingAction();

  async function enable() {
    setError(null);
    const result = await run(() => adminEnableVideo({ videoId: video.id }));
    // Null: Next is on its way to sign-in.
    if (result === null) return;
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    toast(ENABLE_COPY.toast);
    onOpenChange(false);
  }

  return (
    <ConfirmSheet
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      title={ENABLE_COPY.title(video.title)}
      description={ENABLE_COPY.body}
      confirmLabel={ENABLE_COPY.confirm}
      confirmVariant="primary"
      confirmLoading={pending}
      confirmLoadingLabel={ENABLE_COPY.pending}
      onConfirm={(event) => {
        event.preventDefault();
        void enable();
      }}
      cancelLabel={ENABLE_COPY.cancel}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {error ? (
        <Banner tone="error" className="mt-4">
          {error}
        </Banner>
      ) : null}
    </ConfirmSheet>
  );
}
