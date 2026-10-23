"use client";

import { ImageOff } from "lucide-react";
import { SMALL_FRAME } from "@/components/license/poster-frame";
import { useImageFailed } from "@/components/ui/use-image-failed";
import type { VerifiablePostingPlatform } from "@/lib/domain/values";
import { THUMBNAIL_FALLBACK, thumbnailFailedText } from "@/lib/library/post";

/**
 * A verified post's picture in the Where-posted step's same-video compare (04 §9.33): the creator-only thumbnail proxy,
 * in the cover's 64 px box (SMALL_FRAME) at 9:16 (OwnerPostingDTO carries no post size; P11c follow-up), contained,
 * never cropped, with no description (its caption names it). A missing or failed image is 04 §9.12's failed state
 * (ImageOff + "{Platform} · Sync to refresh") in a 64 px row, never a broken image (01 J3.10; useImageFailed). Only
 * verified posts have a picture, so the platform is always a provider. The caller keys it on the src: a new version
 * retries. Never given a pasted or stored posting URL (07 D67).
 */
export function PostPicture({
  platform,
  thumbnailSrc,
}: {
  platform: VerifiablePostingPlatform;
  /** `/api/library/thumbnails/<postId>?v=…`, or null when the post has no image. */
  thumbnailSrc: string | null;
}) {
  const { failed, imageProps } = useImageFailed(thumbnailSrc);
  if (failed || thumbnailSrc === null) {
    return (
      <div className="flex h-16 items-center gap-2 rounded-lg bg-fill px-3">
        <ImageOff aria-hidden size={20} className="shrink-0 text-ink-3" />
        <p className="text-footnote text-ink-2">
          {thumbnailFailedText(platform)}
        </p>
      </div>
    );
  }
  return (
    <div
      style={{
        aspectRatio: `${THUMBNAIL_FALLBACK.width} / ${THUMBNAIL_FALLBACK.height}`,
      }}
      className={SMALL_FRAME}
    >
      {/* biome-ignore lint/performance/noImgElement: the proxy streams a private, per-creator image; next/image would cache it. */}
      <img
        {...imageProps}
        src={thumbnailSrc}
        alt=""
        width={THUMBNAIL_FALLBACK.width}
        height={THUMBNAIL_FALLBACK.height}
        decoding="async"
        className="size-full object-contain"
      />
    </div>
  );
}
