import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Fact = { label: string; value: ReactNode };

/** 04 §9.31: a <dl>; labels stack above values on mobile and sit in a 112 px column from `md`. */
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
        "flex flex-col gap-3 md:grid md:grid-cols-[7rem_1fr] md:items-baseline md:gap-x-4 md:gap-y-2",
        className,
      )}
    >
      {facts.map((fact) => (
        <div key={fact.label} className="flex flex-col gap-1 md:contents">
          <dt className="text-footnote text-ink-2">{fact.label}</dt>
          <dd className="text-callout text-ink">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
