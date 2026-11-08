"use client";

import { Button } from "@/components/ui/button";
import { MY_LICENSES_COPY as COPY } from "@/lib/licensing/my-licenses-copy";
import { GENERIC_ERROR_MESSAGE } from "@/lib/result";

/**
 * S31's page error: 05 §10's generic words and Try again (05 §4.10 draws no error state), so a failed license read
 * never borrows the list's "Couldn't load your licenses." from the error.tsx above it. ErrorBody's words without its
 * MessageBody column: the (buyer) layout already gives this one, and a second would double its padding. `retry()`
 * re-fetches and re-renders the segment (Next ≥ 16.3).
 */
export default function MyLicenseError({ retry }: { retry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-title-1 text-ink wrap-anywhere">
        {GENERIC_ERROR_MESSAGE}
      </h1>
      <Button onClick={() => retry()}>{COPY.tryAgain}</Button>
    </div>
  );
}
