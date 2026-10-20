import { PlatformBadge } from "@/components/platform/platform-badge";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  captionText,
  type LibraryPostDTO,
  thumbnailAlt,
  tileAction,
  tileHref,
  tileLinkId,
  tileMetaDetails,
  tilePills,
} from "@/lib/library/post";
import { cn } from "@/lib/utils";
import { PostThumbnail } from "./post-thumbnail";

/**
 * 04 §9.12: one link (the 9:16 well and the two-line caption) described by the meta line, the neutral pills, and the
 * tertiary action to the same place (07 D39), so at most three focus stops with P27's YouTube icon link. Links to
 * /dashboard/videos/** are plain <a>: those pages come with P10b/P11 (owner answer Q-25), and a prefetch would 404.
 * Hover underlines the caption only; nothing is drawn on the image.
 */
export function LibraryPostTile({ post }: { post: LibraryPostDTO }) {
  const href = tileHref(post);
  const caption = captionText(post);
  const action = tileAction(post);
  const pills = tilePills(post);
  const metaId = `meta-${post.id}`;
  return (
    <li data-post-tile className="flex min-w-0 flex-col items-start">
      <a
        id={tileLinkId(post.id)}
        href={href}
        aria-describedby={metaId}
        className="group block w-full rounded-md"
      >
        <div className="aspect-post overflow-hidden rounded-md bg-fill">
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
        <p
          className={cn(
            "mt-2 line-clamp-2 text-callout underline-offset-4 group-hover:underline",
            caption.fallback ? "text-ink-2" : "text-ink",
          )}
        >
          {caption.text}
        </p>
      </a>
      <p id={metaId} className="mt-1 text-footnote text-ink-2 tabular-nums">
        <PlatformBadge platform={post.platform} />
        {tileMetaDetails(post)
          .map((part) => ` · ${part}`)
          .join("")}
      </p>
      {pills.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pills.map((pill) => (
            <StatusPill key={pill}>{pill}</StatusPill>
          ))}
        </div>
      ) : null}
      {action ? (
        // Text-aligned with the caption; hit-44 keeps the touch target.
        <Button asChild variant="tertiary" size="sm" className="mt-1 px-0">
          <a href={href}>{action}</a>
        </Button>
      ) : null}
    </li>
  );
}
