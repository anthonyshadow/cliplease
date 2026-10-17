"use client";

import { Progress as ProgressPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * 4 px `fill` track with an `action` bar (04 §9.26). `value` is 0–100. Forced colors drop both backgrounds, so there the
 * track gets a border and the bar paints in CanvasText.
 */
export function Progress({
  value,
  label,
  className,
}: {
  value: number;
  /** Accessible name, e.g. "Upload progress". */
  label: string;
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <ProgressPrimitive.Root
      value={clamped}
      aria-label={label}
      className={cn(
        "relative h-1 w-full overflow-hidden rounded-full bg-fill forced-colors:border",
        className,
      )}
    >
      <ProgressPrimitive.Indicator
        className="size-full rounded-full bg-action transition-transform duration-200 ease-out forced-colors:bg-[CanvasText]"
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
