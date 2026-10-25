"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  deleteDraftVideo,
  publishVideo,
  unpublishVideo,
} from "@/app/(dashboard)/dashboard/videos/[id]/actions";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import { usePendingAction } from "@/components/ui/use-pending-action";
import type { VideoStatus } from "@/lib/domain/values";
import { BLOCKERS_HEADING_ID, REVIEW_COPY } from "@/lib/videos/review";
import { videoHref } from "@/lib/videos/steps";
import {
  VIDEO_MENU_COPY,
  VIDEO_PAGE_COPY,
  VIDEOS_TITLE_ID,
  videoMenuAction,
} from "@/lib/videos/video-page";

/**
 * A creator card's Menu (05 §6.8 callout 4 and Interaction; 04 §9.1): Edit to the video's page; Turn off while live
 * and Turn on while off, at once (no confirm: both are reversible); Delete draft through its ConfirmSheet (a bottom
 * sheet below md, a dialog from md; the safe "Keep draft" takes the focus). A Turn on a blocker refuses opens the
 * video's page at its blockers, which take the focus there (TurnButton). The focus comes back to the "···" button when
 * the sheet closes, or to the page title once the draft is gone.
 */
export function VideoCardMenu({
  videoId,
  title,
  status,
}: {
  videoId: string;
  title: string;
  status: VideoStatus;
}) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = usePendingAction();
  // The delete redirects: the sheet stays busy until the list comes back without this card.
  const [deleted, setDeleted] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const opening = useRef(false);
  const action = videoMenuAction(status);
  const canDelete = action === "delete_draft";
  const busy = pending || deleted;

  async function turn() {
    const on = action === "turn_on";
    const result = await run(() =>
      on ? publishVideo({ videoId }) : unpublishVideo({ videoId }),
    );
    if (result === null || result.ok) return;
    if (result.error.code === "publish_blocked") {
      router.push(`${videoHref(videoId)}#${BLOCKERS_HEADING_ID}`);
    } else {
      toast(result.error.message);
    }
  }

  async function remove() {
    setError(null);
    const result = await run(() => deleteDraftVideo({ videoId }));
    // Null: Next is on its way back to the list (or to sign-in).
    if (result === null) setDeleted(true);
    // Published meanwhile (another tab): the refreshed card shows it, so the sheet just closes.
    else if (!result.ok && result.error.code === "video_not_draft") {
      setSheetOpen(false);
    } else if (!result.ok) setError(result.error.message);
  }

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button
            ref={trigger}
            size="icon"
            aria-label={VIDEO_MENU_COPY.more(title)}
            className="ml-auto"
          >
            <Ellipsis aria-hidden />
          </Button>
        </MenuTrigger>
        <MenuContent
          onCloseAutoFocus={(event) => {
            // The sheet takes the focus it opens with.
            if (opening.current) event.preventDefault();
            opening.current = false;
          }}
        >
          <MenuItem asChild>
            <Link href={videoHref(videoId)}>{REVIEW_COPY.edit}</Link>
          </MenuItem>
          {action === "turn_off" || action === "turn_on" ? (
            <MenuItem disabled={busy} onSelect={() => void turn()}>
              {action === "turn_on"
                ? VIDEO_PAGE_COPY.turnOn
                : VIDEO_PAGE_COPY.turnOff}
            </MenuItem>
          ) : null}
          {canDelete ? (
            <MenuItem
              onSelect={() => {
                opening.current = true;
                setError(null);
                setSheetOpen(true);
              }}
            >
              {VIDEO_MENU_COPY.deleteDraft}
            </MenuItem>
          ) : null}
        </MenuContent>
      </Menu>
      {canDelete ? (
        <ConfirmSheet
          open={sheetOpen}
          onOpenChange={(open) => {
            if (!busy) setSheetOpen(open);
          }}
          title={VIDEO_MENU_COPY.deleteTitle}
          confirmLabel={VIDEO_MENU_COPY.deleteDraft}
          confirmLoading={busy}
          confirmLoadingLabel={VIDEO_MENU_COPY.deleting}
          onConfirm={(event) => {
            event.preventDefault();
            void remove();
          }}
          cancelLabel={VIDEO_MENU_COPY.keepDraft}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = deleted
              ? document.getElementById(VIDEOS_TITLE_ID)
              : trigger.current;
            target?.focus();
          }}
        >
          {error ? (
            <p role="alert" className="mt-3 text-callout text-danger-text">
              {error}
            </p>
          ) : null}
        </ConfirmSheet>
      ) : null}
    </>
  );
}
