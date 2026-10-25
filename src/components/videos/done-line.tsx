import { Check } from "lucide-react";
import type { ReactNode } from "react";

/** An attached original's line with its ✓ (04 §9.26 done): the dropzone's done row and the video page's Original file. */
export function DoneLine({ children }: { children: ReactNode }) {
  return (
    <p className="flex min-w-0 items-center gap-2 text-callout text-ink wrap-anywhere">
      <Check
        aria-hidden
        size={16}
        strokeWidth={2}
        className="shrink-0 text-ink"
      />
      {children}
    </p>
  );
}
