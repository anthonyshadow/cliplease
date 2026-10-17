import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Fact = { label: string; value: ReactNode };

/** 04 §9.31: a <dl>; labels stack above values on mobile and sit in a 112 px column from `sm`. */
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
        "flex flex-col gap-3 sm:grid sm:grid-cols-[7rem_1fr] sm:items-baseline sm:gap-x-4 sm:gap-y-2",
        className,
      )}
    >
      {facts.map((fact) => (
        <div key={fact.label} className="flex flex-col gap-1 sm:contents">
          <dt className="text-footnote text-ink-2">{fact.label}</dt>
          <dd className="text-callout text-ink">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
