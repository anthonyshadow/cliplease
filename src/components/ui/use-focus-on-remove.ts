import { type RefObject, useLayoutEffect, useRef } from "react";

/**
 * Where the focus goes when the element is removed while the focus is in it: the element with that id; or a hand-off,
 * called with the element while it is still on the page (so it can look around it), whose answer runs a microtask
 * later, once React has removed the element and whatever went with it. Undefined: the focus is left alone.
 */
export type FocusOnRemoveTarget<T extends HTMLElement> =
  | string
  | ((removed: T) => () => void)
  | undefined;

/**
 * When the element this ref is on is removed while the focus is in it, `target` takes the focus instead of the page
 * (WCAG 2.4.3). A layout-effect cleanup runs before React removes the element, so it still sees the focus inside it.
 */
export function useFocusOnRemove<T extends HTMLElement>(
  target: FocusOnRemoveTarget<T>,
): RefObject<T | null> {
  const box = useRef<T>(null);
  const latest = useRef(target);
  latest.current = target;
  useLayoutEffect(() => {
    const node = box.current;
    return () => {
      const to = latest.current;
      if (!to || !node?.contains(document.activeElement)) return;
      if (typeof to === "string") {
        document.getElementById(to)?.focus({ preventScroll: true });
      } else {
        queueMicrotask(to(node));
      }
    };
  }, []);
  return box;
}
