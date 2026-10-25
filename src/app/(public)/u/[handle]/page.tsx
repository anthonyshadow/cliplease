import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { VIDEO_GRID, WIDE_COLUMN } from "@/components/layout/gutter";
import { EmptyState } from "@/components/ui/empty-state";
import { PublicVideoCard } from "@/components/videos/video-card";
import { creatorUrl, videoUrl } from "@/lib/urls";
import { HANDLE_RE } from "@/lib/validation/handle";
import { getPublicCreator } from "@/server/creators/queries";
import { listPublicVideos } from "@/server/videos/public";

/**
 * The creator behind `/@{param}` (02 §4.3): a param that can't be a handle or names no creator is a 404; mixed case is a
 * 308 to the lowercase URL. The lowercase form is checked first, so the redirect can only point at a creator URL.
 */
async function creatorFor(param: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(param);
  } catch {
    notFound();
  }
  const handle = decoded.toLowerCase();
  if (!HANDLE_RE.test(handle)) notFound();
  if (handle !== decoded) permanentRedirect(creatorUrl(handle));
  const creator = await getPublicCreator(handle);
  if (!creator) notFound();
  return creator;
}

export async function generateMetadata({
  params,
}: PageProps<"/u/[handle]">): Promise<Metadata> {
  const creator = await creatorFor((await params).handle);
  return {
    title: `${creator.displayName} (@${creator.handle})`,
    alternates: { canonical: creatorUrl(creator.handle) },
  };
}

/**
 * S06 (05 §4.6; 03 §7.5): the name and the handle, then the videos anyone may see as cards, newest first, each one link
 * to its license page (P15), 2 / 3 / 4 / 5 columns in the max-w-app column (07 D145, D146); none: "No videos yet.".
 */
export default async function CreatorPage({
  params,
}: PageProps<"/u/[handle]">) {
  const creator = await creatorFor((await params).handle);
  const videos = await listPublicVideos(creator.id);
  return (
    <div className={WIDE_COLUMN}>
      <div className="flex flex-col gap-1">
        <h1 className="text-title-1 text-ink">{creator.displayName}</h1>
        <p className="text-callout text-ink-2">{`@${creator.handle}`}</p>
      </div>
      {videos.length === 0 ? (
        <EmptyState title="No videos yet." />
      ) : (
        <ul data-video-grid className={VIDEO_GRID}>
          {videos.map((video) => (
            <PublicVideoCard
              key={video.id}
              video={video}
              href={videoUrl(creator.handle, video.slug)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
