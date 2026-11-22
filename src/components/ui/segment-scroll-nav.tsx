"use client";

import { type ReactNode, useEffect, useRef } from "react";

/**
 * SegmentedControl's scrolling <nav> (its `scroll` option): once rendered, and each time `current` changes, it centers
 * the current segment inside its own box, as far as the box's ends allow. It moves that box only, never the page; a row
 * that fits (from md) doesn't move.
 */
export function SegmentScrollNav({
  label,
  current,
  className,
  children,
}: {
  label: string;
  /** The current segment's href, or undefined when no segment is current. */
  current: string | undefined;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const box = ref.current;
    if (current === undefined || !box) return;
    const segment = box.querySelector<HTMLElement>('[aria-current="page"]');
    if (!segment) return;
    const outer = box.getBoundingClientRect();
    const inner = segment.getBoundingClientRect();
    box.scrollLeft +=
      inner.left + inner.width / 2 - (outer.left + outer.width / 2);
  }, [current]);
  return (
    <nav ref={ref} aria-label={label} className={className}>
      {children}
    </nav>
  );
}
