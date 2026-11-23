import type { DataColumn } from "@/components/ui/data-table";
import { VideoStatusPill } from "@/components/videos/video-status-pill";
import { ADMIN_COLUMNS, ADMIN_COPY } from "@/lib/admin/copy";
import type { VideoDisabledReason } from "@/lib/domain/values";
import { postingPlatformLabel } from "@/lib/postings/labels";
import { VIDEO_DISABLED_REASON_LABELS } from "@/lib/videos/review";
import type { AdminVideoRow } from "@/server/admin/queries";
import { AdminDate, NONE } from "./admin-cells";
import { VideoRowAction } from "./video-row-action";

const COLUMN = ADMIN_COLUMNS.videos;

/** "Verified · Demo" by the primary verified posting's platform (07 D70, D89), else Self-attested. */
function ownershipText(v: AdminVideoRow): string {
  return v.verifiedPlatform
    ? ADMIN_COPY.verifiedOn(postingPlatformLabel(v.verifiedPlatform, null))
    : ADMIN_COPY.selfAttested;
}

/** A disabled video's reason, with the admin's note under it (admins only, never a creator page; design §6.4). */
function Reason({
  reason,
  note,
}: {
  reason: VideoDisabledReason;
  note: string | null;
}) {
  return (
    <span className="flex flex-col gap-0.5">
      <span>{VIDEO_DISABLED_REASON_LABELS[reason]}</span>
      {note ? (
        <span className="text-footnote text-ink-2">
          {ADMIN_COPY.note(note)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The Videos tab (`?tab=videos`): 05 §7 as drawn, "Req." as Waiting (the count the Disable sheet names), plus Reason
 * and Created (design §6.4).
 */
export const VIDEO_COLUMNS: readonly DataColumn<AdminVideoRow>[] = [
  {
    header: COLUMN.title,
    cell: (v) => <span className="font-semibold">{v.title}</span>,
  },
  {
    header: COLUMN.creator,
    cell: (v) => <span className="wrap-anywhere">{`@${v.creatorHandle}`}</span>,
  },
  { header: COLUMN.ownership, cell: ownershipText },
  {
    header: COLUMN.postings,
    numeric: true,
    cell: (v) => ADMIN_COPY.postings(v.postingCount, v.verifiedPostingCount),
  },
  {
    header: COLUMN.status,
    // One line here: the pill wraps only on the creator's narrow cards.
    cell: (v) => (
      <VideoStatusPill status={v.status} className="h-6 whitespace-nowrap" />
    ),
  },
  { header: COLUMN.waiting, numeric: true, cell: (v) => v.waitingCount },
  {
    header: COLUMN.reason,
    empty: NONE,
    cell: (v) =>
      v.disabledReason ? (
        <Reason reason={v.disabledReason} note={v.disabledNote} />
      ) : null,
  },
  { header: COLUMN.created, cell: (v) => <AdminDate iso={v.createdAt} /> },
  {
    header: COLUMN.action,
    action: true,
    align: "end",
    cell: (v) => (
      <VideoRowAction
        video={{
          id: v.id,
          title: v.title,
          status: v.status,
          waitingCount: v.waitingCount,
        }}
      />
    ),
  },
];
