import { connectErrorBanner } from "@/components/connections/connect-messages";
import { StripConnectParams } from "@/components/connections/strip-connect-params";
import { READING_COLUMN } from "@/components/layout/gutter";
import { PostThumbnail } from "@/components/library/post-thumbnail";
import { VerifiedOwnerBadge } from "@/components/license/verified-owner-badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { LIBRARY_PATH } from "@/lib/library/filter";
import {
  captionText,
  THUMBNAIL_FALLBACK,
  thumbnailAlt,
} from "@/lib/library/post";
import { cn } from "@/lib/utils";
import {
  sourceBadge,
  sourceMetaLine,
  sourcePageState,
  sourceProvenanceLine,
  sourceStatsLine,
  viewOnAriaLabel,
  viewOnLabel,
} from "@/lib/videos/source-page";
import type { SourcePagePostDTO } from "@/server/library/queries";
import { BackLink } from "./back-link";
import { SourceActions } from "./source-actions";

// The well's 9:16 (04 §8.3), as wide as the column or as 50dvh of height allows, so the aspect holds under the cap.
const WELL_WIDTH = `min(100%, calc(50dvh * ${THUMBNAIL_FALLBACK.width} / ${THUMBNAIL_FALLBACK.height}))`;

/**
 * S16, the Source page (05 §6.5; 04 §9.13; 07 D39, D145, D150): one centered max-w-reading column at every tier, no
 * Stepper, nothing written until Make licensable. "‹ Library", the two-tone heading, the post (the larger 9:16 well,
 * ≤ 50dvh with the image contained, through the creator-only proxy; the whole caption; the meta and stats lines; "View on
 * {Platform} ↗"), the provenance line, then the preview and the primary (SourceActions). A connect that came back here
 * with ?error= shows the connect error Banner; ?connected= shows nothing, the badge preview coming back is the sign
 * (owner answer Q-67 a), and StripConnectParams drops both from the address.
 */
export function SourcePage({
  post,
  connectError,
}: {
  post: SourcePagePostDTO;
  /** The page's ?error= after a reconnect (07 D37). */
  connectError: string | string[] | undefined;
}) {
  const caption = captionText(post);
  const stats = sourceStatsLine(post);
  const badge = sourceBadge(post);
  const errorBanner = connectErrorBanner(connectError);
  return (
    <div className={READING_COLUMN}>
      <BackLink href={LIBRARY_PATH}>Library</BackLink>
      <h1 className="text-title-1 text-ink">
        New video.{" "}
        <span className="text-ink-2">From your Library or a file.</span>
      </h1>
      {errorBanner ? (
        <Banner tone={errorBanner.tone}>{errorBanner.message}</Banner>
      ) : null}
      <div className="flex flex-col gap-4">
        <div
          style={{ width: WELL_WIDTH }}
          className="mx-auto aspect-post max-h-[50dvh] overflow-hidden rounded-lg bg-fill"
        >
          <PostThumbnail
            key={post.thumbnailVersion ?? "none"}
            src={post.thumbnailSrc}
            alt={thumbnailAlt(post)}
            platform={post.platform}
            cover={post.kind === "short"}
            width={post.width}
            height={post.height}
          />
        </div>
        <div className="flex flex-col gap-1">
          <p
            className={cn(
              "whitespace-pre-line text-body",
              caption.fallback ? "text-ink-2" : "text-ink",
            )}
          >
            {caption.text}
          </p>
          <p className="text-footnote text-ink-2 tabular-nums">
            {sourceMetaLine(post)}
          </p>
          {stats ? (
            <p className="text-footnote text-ink-2 tabular-nums">{stats}</p>
          ) : null}
        </div>
        {/* P27: YouTube shows its icon with "View on YouTube" here (05 callout 4, 07 D49). */}
        <Button asChild variant="link" size="sm" className="self-start">
          <a
            href={post.permalink}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={viewOnAriaLabel(post.platform)}
          >
            {viewOnLabel(post.platform)}
          </a>
        </Button>
      </div>
      <p className="text-callout text-ink-2">{sourceProvenanceLine(post)}</p>
      <SourceActions
        postId={post.id}
        platform={post.platform}
        state={sourcePageState(post)}
        badge={badge ? <VerifiedOwnerBadge {...badge} /> : null}
      />
      <StripConnectParams />
    </div>
  );
}
