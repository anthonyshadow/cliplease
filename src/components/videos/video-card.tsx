import type { ReactNode } from "react";
import { PosterFrame } from "@/components/license/poster-frame";
import { VerifiedOwnerBadge } from "@/components/license/verified-owner-badge";
import type { Currency } from "@/lib/domain/values";
import { fromPriceText } from "@/lib/pricing/from-price";
import { cn } from "@/lib/utils";
import type { BadgeInput } from "@/lib/videos/ownership";

/** What both VideoCard variants show (04 §9.27). */
export type CardVideo = {
  id: string;
  title: string;
  posterSrc: string | null;
  width: number | null;
  height: number | null;
  badge: BadgeInput;
  fromPriceCents: number | null;
  currency: Currency;
};

/** The text block (04 §9.27): the title on 2 lines, the sm badge, "From {price}", then `children` (the creator's status). */
export function CardText({
  video,
  titleId,
  className,
  children,
}: {
  video: CardVideo;
  titleId?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn("flex min-w-0 flex-col gap-1 rounded-md p-2", className)}
    >
      <h2
        id={titleId}
        className="line-clamp-2 text-callout font-semibold text-ink"
      >
        {video.title}
      </h2>
      <VerifiedOwnerBadge {...video.badge} />
      {video.fromPriceCents === null ? null : (
        <p className="text-footnote text-ink-2 tabular-nums">
          {fromPriceText(video.fromPriceCents, video.currency)}
        </p>
      )}
      {children}
    </div>
  );
}

/**
 * A card on the public /@handle grid (04 §9.27; 05 §4.6): no card surface, on `canvas`; the whole tile is one link to
 * the license page, a plain <a> so a grid of cards prefetches nothing; no status and no hover on the poster.
 */
export function PublicVideoCard({
  video,
  href,
}: {
  video: CardVideo;
  href: string;
}) {
  return (
    <li data-video-card className="min-w-0">
      <a href={href} className="flex min-w-0 flex-col rounded-md">
        <PosterFrame
          size="well"
          src={video.posterSrc}
          alt={`Poster for ${video.title}`}
          width={video.width}
          height={video.height}
        />
        <CardText video={video} />
      </a>
    </li>
  );
}
