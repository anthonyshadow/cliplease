import Link from "next/link";
import { PosterFrame } from "@/components/license/poster-frame";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { PUBLISHED_COPY } from "@/lib/videos/review";
import { videoHref } from "@/lib/videos/steps";
import { isUnlicensable } from "@/lib/videos/video-page";
import type { CreatorVideoCardDTO } from "@/server/videos/queries";
import { UnlicensableNotice } from "./unlicensable-notice";
import { CardText } from "./video-card";
import { VideoCardMenu } from "./video-card-menu";
import { VideoStatusPill } from "./video-status-pill";

/**
 * A card on /dashboard/videos (04 §9.27; 05 §6.8): `surface`, the body one link to the video's page (its text block
 * fills on hover), then its actions, siblings of the link, never inside it: "Copy link" while Live or Off, "Continue"
 * to a draft's first incomplete step, and the Menu. The row wraps, the Menu's "···" at its end, so a narrow card
 * keeps both (a disabled video has neither link nor Turn on). Its own file: the public grid's card loads no Menu.
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
      <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
        {isUnlicensable(video.status, video.fromPriceCents) ? (
          <UnlicensableNotice className="flex-1" />
        ) : video.shareUrl ? (
          <CopyLinkButton
            url={video.shareUrl}
            label={PUBLISHED_COPY.shareLink}
            describedBy={titleId}
            className="flex-1"
          />
        ) : null}
        {video.continueHref ? (
          <Button
            asChild
            variant="tertiary"
            size="sm"
            className="self-start px-0"
          >
            <Link href={video.continueHref} aria-describedby={titleId}>
              Continue
            </Link>
          </Button>
        ) : null}
        <VideoCardMenu
          videoId={video.id}
          title={video.title}
          status={video.status}
        />
      </div>
    </li>
  );
}
