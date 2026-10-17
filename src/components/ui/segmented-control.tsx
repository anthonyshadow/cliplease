import Link from "next/link";
import { cn } from "@/lib/utils";

export type SegmentLink = {
  href: string;
  /** Counts are part of the label: "Waiting 2" (04 §9.8). */
  label: string;
  current?: boolean;
};

/**
 * SegmentedControl, links mode (04 §9.8): URL-driven views, server-rendered, `aria-current="page"` on the current one.
 * Value mode (Radix ToggleGroup) is [H8] and not built.
 */
export function SegmentedControl({
  label,
  items,
  prefetch,
  className,
}: {
  /** Accessible name of the <nav>, e.g. "Requests". */
  label: string;
  items: readonly SegmentLink[];
  prefetch?: boolean;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex h-9 rounded-full bg-fill p-0.5 pointer-coarse:h-11">
        {items.map((item) => (
          <li key={item.href} className="flex flex-1">
            <Link
              href={item.href}
              prefetch={prefetch}
              aria-current={item.current ? "page" : undefined}
              className={cn(
                "hit-44 flex flex-1 items-center justify-center rounded-full px-3 text-callout font-semibold text-ink-2 transition-colors duration-250 ease-out",
                item.current &&
                  "border border-transparent bg-action text-action-ink",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
