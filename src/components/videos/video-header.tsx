import { READING_COLUMN } from "@/components/layout/gutter";
import { PosterFrame } from "@/components/license/poster-frame";
import { VerifiedOwnerBadge } from "@/components/license/verified-owner-badge";
import { CopyLinkField } from "@/components/ui/copy-link-field";
import type { VideoStatus } from "@/lib/domain/values";
import { type BadgeInput, ownerBadge } from "@/lib/videos/ownership";
import { PUBLISHED_COPY } from "@/lib/videos/review";
import type { Actor } from "@/server/auth/actor";
import { listVideoPostings } from "@/server/postings/queries";
import type { CreatorVideoDTO } from "@/server/videos/queries";
import { shareUrl } from "@/server/videos/visibility";
import { BackLink } from "./back-link";
import { VideoStatusPill } from "./video-status-pill";

/**
 * A video past its draft, until P14b builds its page (05 §6.7 callout 1): reads its postings for the sm badge and
 * builds its link while it is Live or Off (a disabled video's controls are read-only, 05 §6.7 States).
 */
export async function VideoHeader({
  actor,
  video,
  handle,
}: {
  actor: Actor;
  video: CreatorVideoDTO;
  handle: string;
}) {
  const postings = await listVideoPostings(actor, video.id);
  return (
    <VideoHeaderView
      video={video}
      badge={ownerBadge(postings, "sm")}
      shareUrl={
        video.status === "disabled" ? null : shareUrl(handle, video.slug)
      }
    />
  );
}

/**
 * The header itself: "‹ Videos", the small poster, the title, its status, the badge, and the link with Copy when
 * `shareUrl` is given. One centered reading column at every tier.
 */
export function VideoHeaderView({
  video,
  badge,
  shareUrl: url,
}: {
  video: Pick<CreatorVideoDTO, "title" | "posterSrc" | "width" | "height"> & {
    status: VideoStatus;
  };
  badge: BadgeInput;
  shareUrl: string | null;
}) {
  return (
    <div data-video-header className={READING_COLUMN}>
      <BackLink href="/dashboard/videos">Videos</BackLink>
      <div className="flex items-start gap-4">
        <PosterFrame
          size="small"
          src={video.posterSrc}
          alt={`Cover image for ${video.title}`}
          width={video.width}
          height={video.height}
        />
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-title-1 text-ink">{video.title}</h1>
          <VideoStatusPill status={video.status} className="self-start" />
          <VerifiedOwnerBadge {...badge} />
        </div>
      </div>
      {url ? (
        <CopyLinkField url={url} label={PUBLISHED_COPY.shareLink} />
      ) : null}
    </div>
  );
}
