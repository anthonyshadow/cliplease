import { type RefObject, useLayoutEffect, useRef } from "react";

/**
 * When the element this ref is on is removed while the focus is in it, the element with id `targetId` takes the focus
 * instead of the page (WCAG 2.4.3). A layout-effect cleanup runs before React removes the element, so it still sees the
 * focus inside it. No target: the focus is left alone.
 */
export function useFocusOnRemove<T extends HTMLElement>(
  targetId: string | undefined,
): RefObject<T | null> {
  const box = useRef<T>(null);
  const target = useRef(targetId);
  target.current = targetId;
  useLayoutEffect(() => {
    const node = box.current;
    return () => {
      const id = target.current;
      if (id && node?.contains(document.activeElement)) {
        document.getElementById(id)?.focus({ preventScroll: true });
      }
    };
  }, []);
  return box;
}
