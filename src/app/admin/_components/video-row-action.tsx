"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DISABLE_COPY, ENABLE_COPY } from "@/lib/admin/copy";
import type { AdminVideoRow } from "@/server/admin/queries";
import { DisableVideoSheet } from "./disable-video-sheet";
import { EnableVideoSheet } from "./enable-video-sheet";

/** What a Videos row's action needs. */
export type AdminVideoAction = Pick<
  AdminVideoRow,
  "id" | "title" | "status" | "waitingCount"
>;

/**
 * A Videos row's action (05 §7 callout 5; design/P21-admin-view.md §4.11): Enable for a disabled video, Disable for any
 * other, a secondary sm button named "Disable {title}" for screen readers, opening its sheet. The sheets mount at the
 * first opening, and each opening starts the sheet afresh. A Disable that leaves requests waiting keeps its sheet open
 * after the row turns to Enable. The focus comes back to the button when the sheet closes. The table renders the row
 * twice (stacked and wide), so each copy has its own sheet.
 */
export function VideoRowAction({ video }: { video: AdminVideoAction }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [sheet, setSheet] = useState<"disable" | "enable" | null>(null);
  const [openings, setOpenings] = useState(0);
  const disabled = video.status === "disabled";
  const copy = disabled ? ENABLE_COPY : DISABLE_COPY;
  const onOpenChange = (open: boolean) => {
    if (!open) setSheet(null);
  };
  const onCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    trigger.current?.focus();
  };
  return (
    <>
      <Button
        ref={trigger}
        variant="secondary"
        size="sm"
        aria-label={copy.actionLabel(video.title)}
        onClick={() => {
          setOpenings((n) => n + 1);
          setSheet(disabled ? "enable" : "disable");
        }}
      >
        {copy.action}
      </Button>
      {openings > 0 ? (
        <>
          <DisableVideoSheet
            key={`disable-${openings}`}
            video={video}
            open={sheet === "disable"}
            onOpenChange={onOpenChange}
            onCloseAutoFocus={onCloseAutoFocus}
          />
          <EnableVideoSheet
            key={`enable-${openings}`}
            video={video}
            open={sheet === "enable"}
            onOpenChange={onOpenChange}
            onCloseAutoFocus={onCloseAutoFocus}
          />
        </>
      ) : null}
    </>
  );
}
