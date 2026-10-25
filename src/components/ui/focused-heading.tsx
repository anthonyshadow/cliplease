"use client";

import { type ReactNode, useEffect, useRef } from "react";

/**
 * A page's h1 that takes the focus when it appears (tabIndex -1): a view that replaced the control the focus was on,
 * such as Review's success view after Publish, starts the reading order here (WCAG 2.4.3). The page goes back to its
 * top first, so the heading is in view (the control may have been at the bottom of a longer page).
 */
export function FocusedHeading({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h1 ref={heading} tabIndex={-1} className={className}>
      {children}
    </h1>
  );
}
