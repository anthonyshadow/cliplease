import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Fact = {
  label: string;
  value: ReactNode;
  /** A row action beside the value, such as the Review's _Edit_. */
  action?: ReactNode;
  /** The row's id (on its label), for a link that jumps to it. */
  id?: string;
  /** A value that starts with no text (an image): from md its label sits level with its top, not on a baseline. */
  alignTop?: boolean;
};

/**
 * 04 §9.31: a <dl>; labels stack above values on mobile and sit in a 112 px column from `md`. The value column's `0`
 * minimum lets the page's wrap rule break a long unbroken value (an email address) instead of widening the grid.
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
          {/* The id on the label: from md the row wrapper is display: contents, with no box to scroll to. */}
          <dt
            id={fact.id}
            className={cn(
              "text-footnote text-ink-2",
              fact.alignTop && "md:self-start",
            )}
          >
            {fact.label}
          </dt>
          <dd
            className={cn(
              "text-callout text-ink",
              fact.alignTop && "md:self-start",
              // The action's label on the value's first line.
              fact.action && "flex items-baseline justify-between gap-3",
            )}
          >
            {fact.action ? (
              <>
                <div className="min-w-0 flex-1">{fact.value}</div>
                {fact.action}
              </>
            ) : (
              fact.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
