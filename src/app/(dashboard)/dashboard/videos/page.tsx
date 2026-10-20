import type { Metadata } from "next";
import Link from "next/link";
import { READING_COLUMN } from "@/components/layout/gutter";
import { Button } from "@/components/ui/button";
import { PRIMARY_WIDTH } from "@/components/ui/primary-width";
import { requireCreator } from "@/server/auth/session";

export const metadata: Metadata = { title: "Videos" };

/** /dashboard/videos until P14a lists them: the title (04 §8) and the way to the plain upload, so Back links land here. */
export default async function VideosPage() {
  await requireCreator("/dashboard/videos");
  return (
    <div className={READING_COLUMN}>
      <h1 className="text-title-1 text-ink">
        Videos. <span className="text-ink-2">Ready to license.</span>
      </h1>
      <Button asChild variant="secondary" className={PRIMARY_WIDTH}>
        <Link href="/dashboard/videos/new">Upload a file</Link>
      </Button>
    </div>
  );
}
