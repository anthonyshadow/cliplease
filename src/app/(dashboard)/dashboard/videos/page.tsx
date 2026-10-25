import type { Metadata } from "next";
import Link from "next/link";
import { VIDEO_GRID, WIDE_COLUMN } from "@/components/layout/gutter";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CreatorVideoCard } from "@/components/videos/video-card";
import { LIBRARY_PATH } from "@/lib/library/filter";
import { NEW_VIDEO_PATH } from "@/lib/videos/steps";
import { requireCreator, toActor } from "@/server/auth/session";
import { listCreatorVideos } from "@/server/videos/queries";

export const metadata: Metadata = { title: "Videos" };

const uploadLink = (
  <Button asChild variant="tertiary" size="sm">
    <Link href={NEW_VIDEO_PATH}>Upload a file</Link>
  </Button>
);

/**
 * S20 `/dashboard/videos` (05 §6.8; 04 §9.27; 07 D145, D146): the two-tone title with "Upload a file", then every video
 * as a card, drafts first, in the full app width (2 / 3 / 4 / 5 columns). With none, the empty state stands for the
 * page: "Videos. Nothing to license yet." with "Open Library" and "Upload a file" (04 §11.9).
 */
export default async function VideosPage() {
  const ctx = await requireCreator("/dashboard/videos");
  const { videos } = await listCreatorVideos(toActor(ctx));
  if (videos.length === 0) {
    return (
      <div className={WIDE_COLUMN}>
        <EmptyState
          as="h1"
          title={
            <>
              Videos.{" "}
              <span className="text-ink-2">Nothing to license yet.</span>
            </>
          }
          description="Pick a post from your Library, or upload a file."
          actions={
            <>
              <Button asChild className="w-full md:w-auto">
                <Link href={LIBRARY_PATH}>Open Library</Link>
              </Button>
              {uploadLink}
            </>
          }
        />
      </div>
    );
  }
  return (
    <div className={WIDE_COLUMN}>
      <div className="flex flex-col gap-1">
        <h1 className="text-title-1 text-ink">
          Videos. <span className="text-ink-2">Ready to license.</span>
        </h1>
        <div className="self-end">{uploadLink}</div>
      </div>
      <ul data-video-grid className={VIDEO_GRID}>
        {videos.map((video) => (
          <CreatorVideoCard key={video.id} video={video} />
        ))}
      </ul>
    </div>
  );
}
