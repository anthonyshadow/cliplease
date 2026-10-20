import { THUMBNAIL_FALLBACK } from "@/lib/library/post";
import { cn } from "@/lib/utils";

/**
 * The creator's poster (04 §9.20, 07 D150), never a platform thumbnail: a `fill` block in the video's aspect (9:16 when
 * its size isn't known) that shows until the image paints (the loading state), the image contained in it, no overlay.
 * A null `src` is the block alone (a frame still being read). `small` is the File step's 64 px cover; `large` keeps
 * `max-h-[60svh]` at every tier, centered in its column. A plain <img>: the poster route is private per viewer (no
 * next/image cache).
 */
export function PosterFrame({
  src,
  alt,
  width,
  height,
  size = "large",
  className,
}: {
  src: string | null;
  alt: string;
  width: number | null;
  height: number | null;
  size?: "small" | "large";
  className?: string;
}) {
  const box = width && height ? { width, height } : THUMBNAIL_FALLBACK;
  return (
    <div
      aria-hidden={src === null || undefined}
      style={{
        aspectRatio: `${box.width} / ${box.height}`,
        // Large: as wide as the column, or as wide as 60svh of height allows, so the aspect holds under the cap.
        width:
          size === "large"
            ? `min(100%, calc(60svh * ${box.width} / ${box.height}))`
            : undefined,
      }}
      className={cn(
        "overflow-hidden rounded-lg bg-fill",
        size === "small" ? "h-16 w-auto" : "mx-auto max-h-[60svh]",
        className,
      )}
    >
      {src === null ? null : (
        // biome-ignore lint/performance/noImgElement: the poster route is private per viewer; next/image would cache it.
        <img
          src={src}
          alt={alt}
          width={box.width}
          height={box.height}
          decoding="async"
          className="size-full object-contain"
        />
      )}
    </div>
  );
}
