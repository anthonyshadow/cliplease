"use client";

import { useImageFailed } from "@/components/ui/use-image-failed";

/**
 * The 48 × 64 poster beside a request's title (04 §9.11; 05 §4.3, §6.3): `fill`, rounded, the poster contained in it.
 * Decorative (alt ""): the title sits next to it. A null `src` (no poster, or one the viewer may not load) or a failed
 * image leaves the block alone. A fixed size is allowed here (07 D145).
 */
export function PosterThumb({ src }: { src: string | null }) {
  return (
    <div
      aria-hidden
      className="h-16 w-12 shrink-0 overflow-hidden rounded-sm bg-fill"
    >
      {src ? <ThumbImage key={src} src={src} /> : null}
    </div>
  );
}

function ThumbImage({ src }: { src: string }) {
  const { failed, imageProps } = useImageFailed(src);
  if (failed) return null;
  return (
    // biome-ignore lint/performance/noImgElement: ADR-09, 07 D150: the poster route decides access and caching, not next/image.
    <img
      {...imageProps}
      src={src}
      alt=""
      width={48}
      height={64}
      decoding="async"
      className="size-full object-contain"
    />
  );
}
