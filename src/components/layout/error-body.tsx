"use client";

import { Button } from "@/components/ui/button";
import { GENERIC_ERROR_MESSAGE } from "@/lib/result";
import { MessageBody } from "./public-shell";

/**
 * The error copy (05 §10), shared by `error.tsx` and `global-error.tsx`; render it only from those client error
 * boundaries. `retry()` re-fetches and re-renders the segment (Next ≥ 16.3); `reset()` would only re-render the
 * cached result, so it can't recover from a Server Component error.
 */
export function ErrorBody({ retry }: { retry: () => void }) {
  return (
    <MessageBody title={GENERIC_ERROR_MESSAGE}>
      <Button onClick={() => retry()}>Try again</Button>
    </MessageBody>
  );
}
