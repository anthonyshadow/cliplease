import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { READING_COLUMN } from "@/components/layout/gutter";
import { VerifiedOwnerBadge } from "@/components/license/verified-owner-badge";
import { BackLink } from "@/components/videos/back-link";
import { SourcePage } from "@/components/videos/source-page";
import { requireCreator, toActor } from "@/server/auth/session";
import { getLibraryPost } from "@/server/library/queries";
import { TitleForm } from "./title-form";

export const metadata: Metadata = { title: "New video" };

// Make licensable's live check calls the platform from this page's Server Action (02 §6.1; Next sets an action's limit
// on its page): nothing for the mock, but P27's real getPost needs the room.
export const maxDuration = 60;

/**
 * `?post=` is S16, the Source page (P11; 05 §6.5, 07 D39): the creator's own visible post, else 404 (a repeated or
 * malformed `post` too). Without it, S18 (05 §6.6): the plain upload's title page, one centered max-w-reading column at
 * every tier (07 D145), no Stepper. The gate's sign-in comes back to the page as asked, `post` included.
 */
export default async function NewVideoPage({
  searchParams,
}: PageProps<"/dashboard/videos/new">) {
  const ctx = await requireCreator();
  const { post, error } = await searchParams;
  if (post !== undefined) {
    if (typeof post !== "string") notFound();
    const source = await getLibraryPost(toActor(ctx), post);
    if (!source) notFound();
    return <SourcePage post={source} connectError={error} />;
  }
  return (
    <div className={READING_COLUMN}>
      <BackLink href="/dashboard/videos">Videos</BackLink>
      <h1 className="text-title-1 text-ink">
        New video.{" "}
        <span className="text-ink-2">From your Library or a file.</span>
      </h1>
      <TitleForm />
      <div className="flex flex-col gap-2">
        <p className="text-footnote text-ink-2">Buyers will see:</p>
        {/* No posting yet, so no verified one (07 D89): the badge with its explainer, 04 §9.19. */}
        <VerifiedOwnerBadge size="lg" ownership="self_attested" />
      </div>
    </div>
  );
}
