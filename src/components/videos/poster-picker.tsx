"use client";

import { useRef } from "react";
import { PosterFrame } from "@/components/license/poster-frame";
import { Button } from "@/components/ui/button";
import { useRefocusOnSwap } from "@/components/ui/use-refocus-on-swap";
import { COVER_IMAGE_TYPES } from "@/lib/media/encode-image";
import { GENERIC_ERROR_MESSAGE } from "@/lib/result";
import { COVER_COPY, TRY_AGAIN } from "@/lib/upload/messages";
import { pickCover, retryCover, useUploads } from "@/lib/upload/upload-store";
import { cn } from "@/lib/utils";
import { editRowLabel, REVIEW_COPY } from "@/lib/videos/review";

/**
 * The cover image (01 J5.11, 07 D19): the frame read from the original while it uploads, or the creator's own JPEG, PNG
 * or WebP ("Choose an image" / "Use a different image", origin creator_image). Shows the local preview at once and the
 * stored poster after a reload; the store keeps the stored cover's preview and origin for the tab's life, so the picker
 * itself needs no refresh when a cover finishes (the Review fetches its server-read parts again, RefreshOnCoverDone).
 * Works without a frame capture too; the Review's and the video page's Cover image rows reuse it (`inRow`).
 */
export function PosterPicker({
  videoId,
  title,
  posterSrc,
  width,
  height,
  inRow,
}: {
  videoId: string;
  title: string;
  /** The stored poster's URL, or null. */
  posterSrc: string | null;
  width: number | null;
  height: number | null;
  /**
   * A Cover image row: the row's label names it, and the frame's button sits at its end: the Review's _Edit_, as Title
   * and Link have (05 §6.5 callout 45), or the video page's "Use a different image" (05 §6.7 callout 5).
   */
  inRow?: "edit" | "change";
}) {
  const cover = useUploads().covers[videoId] ?? null;
  const input = useRef<HTMLInputElement>(null);

  const src = cover?.preview ?? posterSrc;
  const capturing = cover?.phase === "capturing";
  const errorLine =
    cover?.error === "bad_type"
      ? COVER_COPY.badType
      : cover?.error === "too_large"
        ? COVER_COPY.tooLarge
        : cover?.error === "upload_failed"
          ? GENERIC_ERROR_MESSAGE
          : null;
  // No frame from this file (Q-41: also when an older frame is still the cover), or no cover at all.
  const askLine =
    cover?.error === "cant_preview"
      ? COVER_COPY.cantPreview
      : !src && !capturing
        ? COVER_COPY.missing
        : null;

  // A pick swaps "Choose an image" for "Use a different image": focus that fell to the page goes to the new button.
  const refocus = useRefocusOnSwap<HTMLElement>(
    `${Boolean(src)}|${capturing}|${askLine}|${errorLine}`,
    ["button"],
  );

  const choose = () => input.current?.click();
  const edit = inRow === "edit";
  return (
    <section
      {...refocus}
      aria-label={COVER_COPY.label}
      className="flex flex-col gap-3"
    >
      {inRow ? null : (
        <p className="text-callout font-semibold text-ink">
          {COVER_COPY.label}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept={COVER_IMAGE_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void pickCover(videoId, file);
        }}
      />
      {src || capturing ? (
        <div
          className={cn(
            "flex items-center gap-4",
            inRow && "items-start justify-between gap-3",
          )}
        >
          {/* Reading the frame (no src yet): the static fill block (04 §9.20 loading). */}
          <PosterFrame
            size="small"
            src={src}
            alt={`Cover image for ${title}`}
            width={width}
            height={height}
          />
          {askLine ? null : (
            <Button
              variant="tertiary"
              size="sm"
              aria-label={edit ? editRowLabel(COVER_COPY.label) : undefined}
              onClick={choose}
            >
              {edit ? REVIEW_COPY.edit : COVER_COPY.change}
            </Button>
          )}
        </div>
      ) : null}
      {askLine ? (
        <>
          <p className="text-callout text-ink">{askLine}</p>
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={choose}
          >
            {COVER_COPY.choose}
          </Button>
        </>
      ) : null}
      {errorLine ? (
        <p role="alert" className="text-footnote text-danger-text">
          {errorLine}
        </p>
      ) : null}
      {cover?.error === "upload_failed" ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => retryCover(videoId)}
        >
          {TRY_AGAIN}
        </Button>
      ) : null}
    </section>
  );
}
