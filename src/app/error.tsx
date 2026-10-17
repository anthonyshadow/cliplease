"use client";

import { ErrorBody } from "@/components/layout/error-body";
import { PublicShell } from "@/components/layout/public-shell";

// 05 §10: the public chrome around the shared error copy.
export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <PublicShell>
      <ErrorBody retry={retry} />
    </PublicShell>
  );
}
