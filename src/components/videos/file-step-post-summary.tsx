"use client";

import { ImageOff } from "lucide-react";
import { TWO_COLUMN } from "@/components/layout/gutter";
import { PosterFrame } from "@/components/license/poster-frame";
import { useImageFailed } from "@/components/ui/use-image-failed";
import { THUMBNAIL_FALLBACK, thumbnailFailedText } from "@/lib/library/post";
import { cn } from "@/lib/utils";
import { SAME_VIDEO_COPY } from "@/lib/videos/source-page";
import type { CreatorSourcePostDTO } from "@/server/videos/queries";

/** The cover beside the post: the picker's preview or the stored poster, or null while the frame is still read. */
export type SummaryCover = {
  src: string | null;
  width: number | null;
  height: number | null;
};

/**
 * The post's picture for the compare (04 §9.33): the creator-only proxy, 64 px tall in the post's aspect, contained,
 * never cropped, with no description (its caption names it). A missing or failed image is 04 §9.12's failed state
 * (ImageOff + "{Platform} · Sync to refresh") in a 64 px row, never a broken image (01 J3.10; useImageFailed). The
 * caller keys it on the src: a new version retries.
 */
function PostPicture({ post }: { post: CreatorSourcePostDTO }) {
  const { failed, imageProps } = useImageFailed(post.thumbnailSrc);
  if (failed || post.thumbnailSrc === null) {
    return (
      <div className="flex h-16 items-center gap-2 rounded-lg bg-fill px-3">
        <ImageOff aria-hidden size={20} className="shrink-0 text-ink-3" />
        <p className="text-footnote text-ink-2">
          {thumbnailFailedText(post.platform)}
        </p>
      </div>
    );
  }
  const box =
    post.width && post.height
      ? { width: post.width, height: post.height }
      : THUMBNAIL_FALLBACK;
  return (
    <div
      style={{ aspectRatio: `${box.width} / ${box.height}` }}
      className="h-16 w-auto overflow-hidden rounded-lg bg-fill"
    >
      {/* biome-ignore lint/performance/noImgElement: the proxy streams a private, per-creator image; next/image would cache it. */}
      <img
        {...imageProps}
        src={post.thumbnailSrc}
        alt=""
        width={box.width}
        height={box.height}
        decoding="async"
        className="size-full object-contain"
      />
    </div>
  );
}

/**
 * The Library File step's post summary (05 §6.5 callout 9, 07 D39; owner answer Q-66 a): the provenance line and, once
 * the original is attached, the post's picture beside the cover image, captioned "Post" and "Cover image" (Q-65 a).
 * Read-only: the cover picker stays whole in the step. The left column from lg, above the step below it (07 D146).
 */
export function PostSummary({
  post,
  provenance,
  attached,
  cover,
}: {
  post: CreatorSourcePostDTO;
  /** The provenance line, worded by the server FileStep (FileStepLibrary). */
  provenance: string;
  /** The original is ready: the compare shows. */
  attached: boolean;
  /** Null when the video has no cover yet (the picker asks for one). */
  cover: SummaryCover | null;
}) {
  return (
    <div
      data-post-summary
      className={cn(TWO_COLUMN.side, "flex flex-col gap-4")}
    >
      <p className="text-callout text-ink-2">{provenance}</p>
      {attached ? (
        <div className="flex flex-wrap items-start gap-4">
          <figure className="flex flex-col items-start gap-1">
            <PostPicture key={post.thumbnailSrc} post={post} />
            <figcaption className="text-footnote text-ink-2">
              {SAME_VIDEO_COPY.postCaption}
            </figcaption>
          </figure>
          {cover ? (
            <figure className="flex flex-col items-start gap-1">
              <PosterFrame
                size="small"
                src={cover.src}
                alt=""
                width={cover.width}
                height={cover.height}
              />
              <figcaption className="text-footnote text-ink-2">
                {SAME_VIDEO_COPY.coverCaption}
              </figcaption>
            </figure>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
