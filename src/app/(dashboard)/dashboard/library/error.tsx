"use client";

import { WIDE_COLUMN } from "@/components/layout/gutter";
import { LibraryTitle } from "@/components/library/library-title";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { GENERIC_ERROR_MESSAGE } from "@/lib/result";

/**
 * S12's page error (05 §6.1 States): the title, then the error Banner with Try again. `retry()` re-fetches and
 * re-renders the segment (Next ≥ 16.3; P02's decision): `reset()` would only re-render the failed result.
 */
export default function LibraryError({ retry }: { retry: () => void }) {
  return (
    <div className={WIDE_COLUMN}>
      <LibraryTitle />
      <Banner
        tone="error"
        action={
          <Button variant="link" size="sm" onClick={() => retry()}>
            Try again
          </Button>
        }
      >
        {GENERIC_ERROR_MESSAGE}
      </Banner>
    </div>
  );
}
