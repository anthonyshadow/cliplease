"use client";

import { useEffect } from "react";

/**
 * The root's scroll-padding-bottom (globals.css) keeps focus clear of the bar, but WebKit's focus scrolling can
 * still leave a field a few px under it. After each focus move, if something marked `data-covers-focus` (the bar, the
 * floating upload card) covers the focused element's bottom edge, scroll it clear (WCAG 2.2 SC 2.4.11). A sheet above
 * the bar, or the bar hidden or moved to the top at lg, covers nothing. The TabBar and the license page's PriceBar run it.
 */
export function useKeepFocusAboveBar() {
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect();
        const covering = document.elementFromPoint(
          rect.left + rect.width / 2,
          Math.min(rect.bottom, window.innerHeight) - 1,
        );
        const cover = covering?.closest("[data-covers-focus]");
        if (cover && !cover.contains(target)) {
          target.scrollIntoView({ block: "nearest" });
        }
      });
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);
}
