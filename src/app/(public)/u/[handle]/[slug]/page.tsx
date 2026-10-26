import { Music, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { z } from "zod";
import { LICENSE_COLUMNS } from "@/components/layout/gutter";
import { LicensePageClient } from "@/components/license/license-page-client";
import { PosterFrame } from "@/components/license/poster-frame";
import { PostingList } from "@/components/license/posting-list";
import { VerifiedOwnerBadge } from "@/components/license/verified-owner-badge";
import { INLINE_LINK } from "@/components/ui/inline-link";
import { Notice } from "@/components/ui/notice";
import { APP_NAME } from "@/lib/app-name";
import { LICENSE_PAGE_COPY } from "@/lib/licensing/license-page";
import { creatorUrl, videoUrl } from "@/lib/urls";
import { cn } from "@/lib/utils";
import { handleFromParam, isValidSlug } from "@/lib/validation/handle";
import { getLicensePageData } from "@/server/videos/public";

const COPY = LICENSE_PAGE_COPY;

/** The route's params (02 §4.3): the handle decoded and lowercased (with whether it needs the 308), and a stored slug. */
const RouteParams = z.object({
  handle: z.string().transform((param, ctx) => {
    const handle = handleFromParam(param);
    if (handle) return handle;
    ctx.addIssue({ code: "custom", message: "not a handle" });
    return z.NEVER;
  }),
  slug: z.string().refine(isValidSlug),
});

/** The handle and slug `/@{handle}/{slug}` names, or null when either can't be one: a 404. */
function routeOf(params: { handle: string; slug: string }) {
  const route = RouteParams.safeParse(params);
  return route.success ? { ...route.data.handle, slug: route.data.slug } : null;
}

/**
 * 01 J6.4; 04 §12.1: "ClipLease: First snow" (absolute: the root template would add " · ClipLease"), the canonical
 * /@handle/slug, and the link preview from the poster route (absolute through metadataBase). An address that 404s or
 * redirects gets nothing, so no title leaks.
 */
export async function generateMetadata({
  params,
}: PageProps<"/u/[handle]/[slug]">): Promise<Metadata> {
  const route = routeOf(await params);
  if (!route || route.mixedCase) return {};
  const page = await getLicensePageData(route.handle, route.slug);
  if (!page) return {};
  const { video, creator } = page;
  return {
    title: { absolute: `${APP_NAME}: ${video.title}` },
    alternates: { canonical: videoUrl(creator.handle, video.slug) },
    openGraph: {
      title: `${video.title} · @${creator.handle}`,
      description: COPY.ogDescription,
      // No width or height: the poster's own size isn't stored (the video's isn't the poster's).
      images: [{ url: video.posterUrl, alt: COPY.posterAlt(video.title) }],
    },
  };
}

/**
 * S01, the license page (01 J6–J7; 05 §4.1; 07 D148), for anyone, signed in or not: a published, publicly available,
 * licensable video, else the route's 404 (07 D03, D72); mixed case is a 308 to the lowercase handle. This server part
 * draws the left column (poster, title, ownership, where it was posted, the music and people notices); the client part
 * the rest and the PriceBar. No loading.tsx: a streamed route answers 200, and every miss here must be a real 404
 * (owner answer Q-110 a).
 */
export default async function LicensePage({
  params,
}: PageProps<"/u/[handle]/[slug]">) {
  const route = routeOf(await params);
  if (!route) notFound();
  if (route.mixedCase) permanentRedirect(videoUrl(route.handle, route.slug));
  const page = await getLicensePageData(route.handle, route.slug);
  if (!page) notFound();
  const { video, creator } = page;
  return (
    <div className={LICENSE_COLUMNS.page}>
      <div data-license-side className={LICENSE_COLUMNS.side}>
        <PosterFrame
          src={video.posterUrl}
          alt={COPY.posterAlt(video.title)}
          width={video.width}
          height={video.height}
          className="shrink-0"
        />
        <div className="flex flex-col gap-1">
          <h1 className="text-title-1 text-ink">{video.title}</h1>
          <p className="text-callout text-ink-2">
            {`${creator.displayName} · `}
            <Link
              href={creatorUrl(creator.handle)}
              prefetch={false}
              className={cn(INLINE_LINK, "hit-44")}
            >
              {`@${creator.handle}`}
            </Link>
          </p>
        </div>
        <VerifiedOwnerBadge {...page.badge} />
        <PostingList postings={page.postings.postings} />
        {video.containsMusic ? (
          <Notice icon={Music} title={COPY.music.title}>
            {COPY.music.body}
          </Notice>
        ) : null}
        {video.identifiablePeople ? (
          <Notice icon={Users}>{COPY.people}</Notice>
        ) : null}
      </div>
      <LicensePageClient page={page} submissionId={crypto.randomUUID()} />
    </div>
  );
}
