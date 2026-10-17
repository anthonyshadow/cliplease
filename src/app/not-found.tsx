import type { Metadata } from "next";
import { NotFoundBody } from "@/components/layout/not-found-body";
import { PublicShell } from "@/components/layout/public-shell";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

// Unmatched URLs render inside the root layout only, so this page brings its own public chrome.
export default function NotFound() {
  return (
    <PublicShell>
      <NotFoundBody />
    </PublicShell>
  );
}
