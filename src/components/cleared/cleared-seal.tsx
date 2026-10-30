import { cn } from "@/lib/utils";

/** The seal's sizes (04 §10.1): 16 a row or toast, 40 /r and /verify, 72 and 88 /l (below and from lg). */
export type ClearedSealSize = 16 | 40 | 72 | 88;

/**
 * The cleared seal, static (04 §10.1; the drawn-in variant is [H8]): a `cleared` disc with a `cleared-ink` check, its
 * stroke 8 % of the diameter. Decorative: the meaning is always in the text beside it. `size` sets the box; a caller
 * that changes size by tier (P20's /l: 72, 88 from lg) passes `lg:size-22` style classes too, never the window width.
 */
export function ClearedSeal({
  size,
  className,
}: {
  size: ClearedSealSize;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
    >
      <circle cx="50" cy="50" r="50" className="fill-cleared" />
      <path
        d="M29 52 L44 66 L72 36"
        fill="none"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray="1"
        className="stroke-cleared-ink"
      />
    </svg>
  );
}
