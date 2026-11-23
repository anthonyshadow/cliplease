"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DISABLE_COPY, ENABLE_COPY } from "@/lib/admin/copy";
import type { AdminVideoRow } from "@/server/admin/queries";
import { DisableVideoSheet } from "./disable-video-sheet";
import { EnableVideoSheet } from "./enable-video-sheet";
import { useFocusHandOff } from "./use-focus-hand-off";
import { useSheetOpenings } from "./use-sheet-openings";

/** What a Videos row's action needs. */
export type AdminVideoAction = Pick<
  AdminVideoRow,
  "id" | "title" | "status" | "waitingCount"
>;

/**
 * A Videos row's action (05 §7 callout 5; design/P21-admin-view.md §4.11): Enable for a disabled video, Disable for any
 * other, a secondary sm button named "Disable {title}" for screen readers, opening its sheet. The sheets mount at the
 * first opening, and each opening starts the sheet afresh. A Disable that leaves requests waiting keeps its sheet open
 * after the row turns to Enable (the sheet is the one the button opened). The focus comes back to the button when the
 * sheet closes (useFocusHandOff). The table renders the row twice (stacked and wide), so each copy has its own sheet.
 */
export function VideoRowAction({ video }: { video: AdminVideoAction }) {
  const { trigger, opening, onCloseAutoFocus } =
    useFocusHandOff<HTMLButtonElement>();
  const sheet = useSheetOpenings();
  const [kind, setKind] = useState<"disable" | "enable">("disable");
  const disabled = video.status === "disabled";
  const copy = disabled ? ENABLE_COPY : DISABLE_COPY;
  return (
    <>
      <Button
        ref={trigger}
        variant="secondary"
        size="sm"
        aria-label={copy.actionLabel(video.title)}
        onClick={() => {
          opening();
          setKind(disabled ? "enable" : "disable");
          sheet.show();
        }}
      >
        {copy.action}
      </Button>
      {sheet.mounted ? (
        <>
          <DisableVideoSheet
            key={`disable-${sheet.openings}`}
            video={video}
            open={sheet.open && kind === "disable"}
            onOpenChange={sheet.onOpenChange}
            onCloseAutoFocus={onCloseAutoFocus}
          />
          <EnableVideoSheet
            key={`enable-${sheet.openings}`}
            video={video}
            open={sheet.open && kind === "enable"}
            onOpenChange={sheet.onOpenChange}
            onCloseAutoFocus={onCloseAutoFocus}
          />
        </>
      ) : null}
    </>
  );
}
