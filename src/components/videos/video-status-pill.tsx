import { StatusPill } from "@/components/ui/status-pill";
import { APP_NAME } from "@/lib/app-name";
import type { VideoStatus } from "@/lib/domain/values";
import { cn } from "@/lib/utils";

/** A video's status in 04 §9.9's words (07 D03): Draft · Live · Off · Disabled by {APP_NAME}. */
const VIDEO_STATUS_LABEL = {
  draft: "Draft",
  published: "Live",
  unpublished: "Off",
  disabled: `Disabled by ${APP_NAME}`,
} as const satisfies Record<VideoStatus, string>;

/**
 * The video's StatusPill (04 §9.9, §9.27): Live with the solid dot, Draft with the hollow one, Off plain, Disabled in
 * danger. The long Disabled label may wrap in a narrow card instead of widening it.
 */
export function VideoStatusPill({
  status,
  className,
}: {
  status: VideoStatus;
  className?: string;
}) {
  return (
    <StatusPill
      tone={status === "disabled" ? "danger" : "neutral"}
      dot={
        status === "published"
          ? "solid"
          : status === "draft"
            ? "hollow"
            : undefined
      }
      className={cn(
        status === "disabled" && "h-auto min-h-6 whitespace-normal",
        className,
      )}
    >
      {VIDEO_STATUS_LABEL[status]}
    </StatusPill>
  );
}
