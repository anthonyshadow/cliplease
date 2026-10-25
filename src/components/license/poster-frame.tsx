import { THUMBNAIL_FALLBACK } from "@/lib/library/post";
import { cn } from "@/lib/utils";

/** The media block: `fill`, rounded, the image clipped to it. */
const FRAME = "overflow-hidden rounded-lg bg-fill";

/**
 * The 64 px media box (the File step's and Where posted's cover, a verified post's picture in the same-video compare):
 * the caller sets its aspect, and it is sized by its height and that aspect only. `contain-size`: WebKit otherwise sized
 * a wrapping row's item around its image (an SVG thumbnail, Demo's), as wide as the row (P11c e2e).
 */
export const SMALL_FRAME = `${FRAME} h-16 w-auto contain-size`;

/**
 * The creator's poster (04 §9.20, 07 D150), never a platform thumbnail: a `fill` block in the video's aspect (9:16 when
 * its size isn't known) that shows until the image paints (the loading state), the image contained in it, no overlay.
 * A null `src` is the block alone (a frame still being read). `small` is SMALL_FRAME, the 64 px cover; `large` keeps
 * `max-h-[60svh]` at every tier, centered in its column; `well` is a VideoCard's (04 §9.27): the grid's fixed
 * `aspect-post` well, its poster loaded lazily. A plain <img> (ADR-09, 07 D150): the poster route decides who sees it
 * and how it is cached, never next/image.
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
  size?: "small" | "large" | "well";
  className?: string;
}) {
  const box = width && height ? { width, height } : THUMBNAIL_FALLBACK;
  const well = size === "well";
  return (
    <div
      aria-hidden={src === null || undefined}
      style={
        well
          ? undefined
          : {
              aspectRatio: `${box.width} / ${box.height}`,
              // Large: as wide as the column, or as wide as 60svh of height allows, so the aspect holds under the cap.
              width:
                size === "large"
                  ? `min(100%, calc(60svh * ${box.width} / ${box.height}))`
                  : undefined,
            }
      }
      className={cn(
        well
          ? "aspect-post w-full overflow-hidden rounded-md bg-fill"
          : size === "small"
            ? SMALL_FRAME
            : `${FRAME} mx-auto max-h-[60svh]`,
        className,
      )}
    >
      {src === null ? null : (
        // biome-ignore lint/performance/noImgElement: ADR-09, 07 D150: the poster route decides access and caching, not next/image.
        <img
          src={src}
          alt={alt}
          width={box.width}
          height={box.height}
          decoding="async"
          loading={well ? "lazy" : undefined}
          className="size-full object-contain"
        />
      )}
    </div>
  );
}
