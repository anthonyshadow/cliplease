import Link from "next/link";
import { cn } from "@/lib/utils";
import { SegmentScrollNav } from "./segment-scroll-nav";

export type SegmentLink = {
  href: string;
  /** Counts are part of the label: "Waiting 2" (04 §9.8). */
  label: string;
  current?: boolean;
};

/**
 * SegmentedControl, links mode (04 §9.8): URL-driven views, server-rendered, `aria-current="page"` on the current one.
 * `scroll` (the admin's six tabs, 07 D146): below md the segments keep their own widths and scroll sideways inside a
 * box padded by the 44 px hit areas and the focus ring, the page never does, and the current one is scrolled into view;
 * from md they are equal segments. Value mode (Radix ToggleGroup) is [H8] and not built.
 */
export function SegmentedControl({
  label,
  items,
  prefetch,
  scroll = false,
  className,
}: {
  /** Accessible name of the <nav>, e.g. "Requests". */
  label: string;
  items: readonly SegmentLink[];
  prefetch?: boolean;
  scroll?: boolean;
  className?: string;
}) {
  const list = (
    <ul
      className={cn(
        // 1fr columns: every segment as wide as the widest label, which never wraps (04 §9.8).
        "grid h-9 auto-cols-fr grid-flow-col rounded-full bg-fill p-0.5 pointer-coarse:h-11",
        scroll && "flex w-max md:grid md:w-full",
      )}
    >
      {items.map((item) => (
        <li key={item.href} className="flex">
          <Link
            href={item.href}
            prefetch={prefetch}
            aria-current={item.current ? "page" : undefined}
            className={cn(
              "hit-44 flex flex-1 items-center justify-center whitespace-nowrap rounded-full px-3 text-callout font-semibold text-ink-2 transition-colors duration-250 ease-out",
              item.current &&
                "border border-transparent bg-action text-action-ink",
            )}
          >
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
  if (!scroll) {
    return (
      <nav aria-label={label} className={className}>
        {list}
      </nav>
    );
  }
  return (
    <SegmentScrollNav
      label={label}
      current={items.find((item) => item.current)?.href}
      // The 4 px padding holds the hit areas and the focus ring, which the scroll box would clip; the negative margin
      // keeps the row in line with the page. No scrollbar, as the Library's chip rows: the cut-off segment shows more.
      className={cn(
        "scrollbar-none -m-1 overflow-x-auto p-1 md:m-0 md:overflow-visible md:p-0",
        className,
      )}
    >
      {list}
    </SegmentScrollNav>
  );
}
