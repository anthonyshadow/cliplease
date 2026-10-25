import Link from "next/link";
import type { ReactNode } from "react";
import { PosterFrame } from "@/components/license/poster-frame";
import { VerifiedOwnerBadge } from "@/components/license/verified-owner-badge";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import type { Currency } from "@/lib/domain/values";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BadgeInput } from "@/lib/videos/ownership";
import { PUBLISHED_COPY } from "@/lib/videos/review";
import { videoHref } from "@/lib/videos/steps";
import type { CreatorVideoCardDTO } from "@/server/videos/queries";
import { VideoStatusPill } from "./video-status-pill";

/** What both VideoCard variants show (04 §9.27). */
type CardVideo = {
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
function CardText({
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
          {`From ${formatMoney(video.fromPriceCents, video.currency)}`}
        </p>
      )}
      {children}
    </div>
  );
}

/**
 * A card on /dashboard/videos (04 §9.27; 05 §6.8): `surface`, the body one link to the video's page (its text block
 * fills on hover), then its own action, never inside the link: "Copy link" while Live, "Continue" to a draft's first
 * incomplete step. Off and Disabled have none until P14b's Menu.
 */
export function CreatorVideoCard({ video }: { video: CreatorVideoCardDTO }) {
  const titleId = `video-title-${video.id}`;
  return (
    <li
      data-video-card
      className="flex min-w-0 flex-col gap-1 rounded-lg bg-surface p-1.5"
    >
      <Link href={videoHref(video.id)} className="group flex min-w-0 flex-col">
        <PosterFrame
          size="well"
          src={video.posterSrc}
          alt={`Poster for ${video.title}`}
          width={video.width}
          height={video.height}
        />
        <CardText
          video={video}
          titleId={titleId}
          className="group-hover:bg-fill"
        >
          <VideoStatusPill status={video.status} className="self-start" />
        </CardText>
      </Link>
      {video.shareUrl ? (
        <CopyLinkButton
          url={video.shareUrl}
          label={PUBLISHED_COPY.shareLink}
          describedBy={titleId}
          className="px-2 pb-2"
        />
      ) : null}
      {video.continueHref ? (
        <Button
          asChild
          variant="tertiary"
          size="sm"
          className="mx-2 self-start px-0"
        >
          <Link href={video.continueHref} aria-describedby={titleId}>
            Continue
          </Link>
        </Button>
      ) : null}
    </li>
  );
}

/**
 * A card on the public /@handle grid (04 §9.27; 05 §4.6): no card surface, on `canvas`; the whole tile is one link to
 * the license page (P15; a plain <a> until it exists, so nothing prefetches a 404), no status and no hover on the
 * poster.
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
