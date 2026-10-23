import { Check } from "lucide-react";
import { PosterFrame } from "@/components/license/poster-frame";
import { hintsLine } from "@/lib/upload/messages";
import { cn } from "@/lib/utils";

/**
 * The video beside its step (05 §6.5 Where posted Tablet and Desktop frames; 07 D146, D156): the cover (PosterFrame
 * large, ≤ 60svh, centered), "✓ Original attached · 0:14 · 1080 × 1920" and, for a Library video, the provenance line.
 * A visibility rule from md: below md the Mobile frame has no summary; on Tablet it sits above the step in the 640
 * column; from lg it is the left column (the caller places it with TWO_COLUMN.side). Server-renderable.
 */
export function VideoSummary({
  video,
  provenance,
  className,
}: {
  video: {
    title: string;
    posterSrc: string | null;
    durationMs: number | null;
    width: number | null;
    height: number | null;
  };
  /** provenanceLine for a Library video; null for an upload. */
  provenance: string | null;
  className?: string;
}) {
  return (
    <div
      data-video-summary
      className={cn("hidden min-w-0 flex-col gap-3 md:flex", className)}
    >
      <PosterFrame
        src={video.posterSrc}
        alt={`Cover image for ${video.title}`}
        width={video.width}
        height={video.height}
      />
      <p className="flex items-start gap-2 text-callout text-ink">
        <Check
          aria-hidden
          size={16}
          strokeWidth={2}
          className="mt-1 shrink-0 text-ink"
        />
        {hintsLine(video)}
      </p>
      {provenance === null ? null : (
        <p className="text-callout text-ink-2">{provenance}</p>
      )}
    </div>
  );
}
