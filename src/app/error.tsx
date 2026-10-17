"use client";

import { SHELL_GUTTER } from "@/components/layout/gutter";
import { NavBar } from "@/components/layout/nav-bar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 05 §10. `retry()` re-fetches and re-renders the segment (Next ≥ 16.3); `reset()` would only re-render the
// cached result, so it can't recover from a Server Component error.
export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <>
      <NavBar variant="public" />
      <main className={cn("mx-auto w-full max-w-app", SHELL_GUTTER)}>
        <div className="mx-auto flex max-w-reading flex-col items-start gap-4 py-6 lg:py-12">
          <h1 className="text-title-1 text-ink">
            Something went wrong. Try again.
          </h1>
          <Button onClick={() => retry()}>Try again</Button>
        </div>
      </main>
    </>
  );
}
