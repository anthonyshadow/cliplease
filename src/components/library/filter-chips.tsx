import Link from "next/link";
import { cn } from "@/lib/utils";

const CHIP =
  "hit-44 inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-callout font-semibold tabular-nums transition-colors duration-200 ease-standard";
const OFF = "border-hairline-strong bg-surface text-ink hover:border-ink";
const ON = "border-transparent bg-action text-action-ink";

/**
 * FilterChips, single mode (04 §9.14): links that set ?platform= (server-rendered and shareable), "All {n}" then one
 * chip per linked platform with its count; the current one is filled with aria-current="page". The row scrolls inside
 * itself where it overflows (07 D146); the 4 px block padding keeps each 44 px target inside the scroller.
 */
export function FilterChips({
  chips,
  className,
}: {
  chips: readonly {
    key: string;
    label: string;
    href: string;
    current: boolean;
  }[];
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 py-1",
        className,
      )}
    >
      {chips.map((chip) => (
        <li key={chip.key} className="flex">
          <Link
            href={chip.href}
            aria-current={chip.current ? "page" : undefined}
            className={cn(CHIP, chip.current ? ON : OFF)}
          >
            {chip.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
