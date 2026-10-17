import { cva } from "class-variance-authority";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatusPillTone = "neutral" | "awaiting" | "cleared" | "danger";
/** Neutral pills only: solid for "on" states (Connected, Live, Verified), hollow for drafts (Draft, Not verified). */
export type StatusPillDot = "solid" | "hollow";

// 04 §9.9: 24 px tall, caption text. `cleared` is the only filled pill.
export const pillVariants = cva(
  "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-transparent px-2.5 text-caption tabular-nums",
  {
    variants: {
      tone: {
        neutral: "bg-fill text-ink-2",
        awaiting: "bg-awaiting-tint text-awaiting-text",
        cleared: "bg-cleared text-cleared-ink",
        danger: "bg-danger-tint text-danger-text",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

/** The 6 px dot: awaiting and danger always; neutral only when `dot` is set; cleared never (it shows a check). */
function dotColor(tone: StatusPillTone, dot?: StatusPillDot): string | null {
  if (tone === "awaiting") return "bg-awaiting";
  if (tone === "danger") return "bg-danger";
  if (tone !== "neutral" || dot === undefined) return null;
  return dot === "solid" ? "bg-ink" : "ring-1 ring-ink-3";
}

/** A status label in words plus tint (04 §9.9). The label is passed in: use the exact 01 §3.0 / 04 §9.9 labels. */
export function StatusPill({
  tone = "neutral",
  dot,
  className,
  children,
}: {
  tone?: StatusPillTone;
  dot?: StatusPillDot;
  className?: string;
  children: ReactNode;
}) {
  const color = dotColor(tone, dot);
  return (
    <span className={cn(pillVariants({ tone }), className)}>
      {tone === "cleared" ? (
        <Check aria-hidden size={12} strokeWidth={2.5} className="shrink-0" />
      ) : null}
      {color ? (
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", color)}
        />
      ) : null}
      {children}
    </span>
  );
}

export { CountdownChip } from "./countdown-chip";
