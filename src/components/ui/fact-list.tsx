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
        "grid gap-x-4 gap-y-3 sm:grid-cols-[7rem_1fr] sm:gap-y-2",
        className,
      )}
    >
      {facts.map((fact) => (
        <div key={fact.label} className="contents">
          <dt className="text-footnote text-ink-2 sm:pt-px">{fact.label}</dt>
          <dd className="-mt-2 text-callout text-ink sm:mt-0">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
