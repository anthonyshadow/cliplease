"use client";

import { ImageOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SocialProviderId } from "@/lib/domain/values";
import { THUMBNAIL_FALLBACK, thumbnailFailedText } from "@/lib/library/post";
import { cn } from "@/lib/utils";

/**
 * A tile's image (04 §9.12, 07 D150): contained in the 9:16 well (a Short fills it), explicit width and height so nothing
 * shifts, lazy. A missing or failed image becomes ImageOff + "{Platform} · Sync to refresh", never a broken image
 * (01 J3.10). An image that failed before hydration fired no onError, so the mount checks it too. The caller keys it on
 * the thumbnail's version: a sync that stores a new one tries again.
 */
export function PostThumbnail({
  src,
  alt,
  platform,
  cover,
  width,
  height,
}: {
  src: string | null;
  alt: string;
  platform: SocialProviderId;
  /** A YouTube Short fills the well (04 §8.3). */
  cover: boolean;
  width: number | null;
  height: number | null;
}) {
  const [failed, setFailed] = useState(src === null);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = image.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed || src === null) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 p-3 text-center">
        <ImageOff aria-hidden size={20} className="text-ink-3" />
        <p className="text-footnote text-ink-2">
          {thumbnailFailedText(platform)}
        </p>
      </div>
    );
  }
  return (
    // biome-ignore lint/performance/noImgElement: the proxy streams a private, per-creator SVG; next/image would cache it.
    <img
      ref={image}
      src={src}
      alt={alt}
      width={width ?? THUMBNAIL_FALLBACK.width}
      height={height ?? THUMBNAIL_FALLBACK.height}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("size-full", cover ? "object-cover" : "object-contain")}
    />
  );
}
