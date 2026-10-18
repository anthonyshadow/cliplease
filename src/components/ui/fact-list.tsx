import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Fact = { label: string; value: ReactNode };

/**
 * 04 §9.31: a <dl>; labels stack above values on mobile and sit in a 112 px column from `md`. A long unbroken value (an
 * email address) wraps instead of pushing the page sideways.
 */
export function FactList({
  facts,
  className,
}: {
  facts: readonly Fact[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "flex flex-col gap-3 md:grid md:grid-cols-[7rem_minmax(0,1fr)] md:items-baseline md:gap-x-4 md:gap-y-2",
        className,
      )}
    >
      {facts.map((fact) => (
        <div key={fact.label} className="flex flex-col gap-1 md:contents">
          <dt className="text-footnote text-ink-2">{fact.label}</dt>
          <dd className="min-w-0 text-callout text-ink wrap-anywhere">
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
