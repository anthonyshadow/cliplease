import { UserRound } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { READING_COLUMN } from "@/components/layout/gutter";
import { BackLink } from "@/components/videos/back-link";
import { requireCreator } from "@/server/auth/session";
import { TitleForm } from "./title-form";

export const metadata: Metadata = { title: "New video" };

/**
 * S18 (05 §6.6): the plain upload's title page, one centered max-w-reading column at every tier (07 D145), no Stepper.
 * `?post=` is P11's Source page: 404 until then (owner answer Q-25 a).
 */
export default async function NewVideoPage({
  searchParams,
}: PageProps<"/dashboard/videos/new">) {
  await requireCreator("/dashboard/videos/new");
  const { post } = await searchParams;
  if (post !== undefined) notFound();
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
        {/* P11 swaps in VerifiedOwnerBadge when a link verifies (07 D66). */}
        <p className="flex items-center gap-2 text-callout text-ink-2">
          <UserRound aria-hidden size={16} strokeWidth={2} />
          Self-attested by the creator
        </p>
      </div>
    </div>
  );
}
