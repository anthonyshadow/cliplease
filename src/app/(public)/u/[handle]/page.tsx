import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { creatorUrl } from "@/lib/urls";
import { HANDLE_RE } from "@/lib/validation/handle";
import { getPublicCreator } from "@/server/creators/queries";

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

/** S06 (05 §4.6): the name, the handle and, until P14a's grid, "No videos yet." in the max-w-app column (07 D145). */
export default async function CreatorPage({
  params,
}: PageProps<"/u/[handle]">) {
  const creator = await creatorFor((await params).handle);
  return (
    <div className="flex flex-col gap-6 py-6 lg:py-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-title-1 text-ink">{creator.displayName}</h1>
        <p className="text-callout text-ink-2">{`@${creator.handle}`}</p>
      </div>
      <EmptyState title="No videos yet." />
    </div>
  );
}
