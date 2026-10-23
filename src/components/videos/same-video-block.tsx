"use client";

import { type ReactNode, useState } from "react";
import { PosterFrame } from "@/components/license/poster-frame";
import { Banner } from "@/components/ui/banner";
import { NativeCheckbox } from "@/components/ui/checkbox";
import { isOneOf, VERIFIABLE_POSTING_PLATFORMS } from "@/lib/domain/values";
import { SAME_VIDEO_COPY } from "@/lib/postings/copy";
import { POSTINGS_FIELD, verifiedPostingsKey } from "@/lib/postings/form";
import type { OwnerPostingDTO } from "@/lib/postings/types";
import { PostPicture } from "./post-picture";
import type { sameVideoView } from "./posting-picker-state";

type SameVideo = NonNullable<ReturnType<typeof sameVideoView>>;

/**
 * "These posts show this same video" (07 D69, 01 J5.10; moved from the File step; owner answers Q-75, Q-76 a): a `fill`
 * block in the step column, shown while at least one saved posting is verified. The cover image ("Cover image", P10b's
 * poster route) first, then each verified post's picture through the creator-only thumbnail proxy (64 px tall,
 * contained, never cropped; "Post", or "{Platform} post" when there are several), in one wrapping row: one line whenever
 * it fits, wrapping instead of ever scrolling or widening the page (07 D146, D153). Then a warning per post whose length
 * differs from the file's by more than 1 s, above the required tick. The tick posts `sameVideo=on` with `verifiedKey`,
 * the posts it confirms; it renders ticked once confirmed, and the caller keys the block on that key and the stored
 * tick, so a different verified set brings it back unticked. Missing on a Continue that needed it: "Confirm these
 * posts show this same video" on the box (the caller moves focus there). Never a pasted or stored posting URL in an image.
 */
export function SameVideoBlock({
  view,
  confirmed,
  missing,
  onTick,
  cover,
}: {
  view: SameVideo;
  confirmed: boolean;
  /** The Continue's answer: the tick was required and missing. */
  missing: boolean;
  onTick: () => void;
  cover: {
    src: string | null;
    width: number | null;
    height: number | null;
  };
}) {
  const [ticked, setTicked] = useState(confirmed);
  return (
    <div
      data-same-video
      className="flex min-w-0 flex-col gap-4 rounded-md bg-fill p-4"
    >
      <div className="flex min-w-0 flex-wrap items-start gap-4">
        <Figure caption={SAME_VIDEO_COPY.cover}>
          <PosterFrame
            size="small"
            src={cover.src}
            alt=""
            width={cover.width}
            height={cover.height}
          />
        </Figure>
        {view.verified.map((posting) => (
          <VerifiedPicture
            key={posting.id}
            posting={posting}
            several={view.several}
          />
        ))}
      </div>
      {view.warnings.map((warning) => (
        <Banner key={warning.id} tone="warning">
          {warning.text}
        </Banner>
      ))}
      <input
        type="hidden"
        name={POSTINGS_FIELD.verifiedKey}
        value={verifiedPostingsKey(view.verified)}
      />
      <NativeCheckbox
        name={POSTINGS_FIELD.sameVideo}
        label={SAME_VIDEO_COPY.tick}
        checked={ticked}
        onChange={(event) => {
          setTicked(event.target.checked);
          onTick();
        }}
        error={missing && !ticked ? SAME_VIDEO_COPY.missingTick : undefined}
      />
    </div>
  );
}

function Figure({
  caption,
  children,
}: {
  caption: string;
  children: ReactNode;
}) {
  return (
    <figure className="flex min-w-0 flex-col items-start gap-1">
      {children}
      <figcaption className="text-caption text-ink-2">{caption}</figcaption>
    </figure>
  );
}

function VerifiedPicture({
  posting,
  several,
}: {
  posting: OwnerPostingDTO;
  several: boolean;
}) {
  // Only a provider's post can be verified (07 D70); a row that isn't one has no picture to show.
  if (!isOneOf(VERIFIABLE_POSTING_PLATFORMS, posting.platform)) return null;
  return (
    <Figure caption={SAME_VIDEO_COPY.postCaption(posting.label, several)}>
      <PostPicture
        key={posting.thumbnailSrc}
        platform={posting.platform}
        thumbnailSrc={posting.thumbnailSrc}
      />
    </Figure>
  );
}
