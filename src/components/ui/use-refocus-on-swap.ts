import {
  type FocusEvent,
  type RefObject,
  useLayoutEffect,
  useRef,
} from "react";

/**
 * Keeps keyboard focus in a box whose controls swap (an upload's states, a cover picked): when focus was inside and the
 * focused control went away (focus fell to the page), the first match of `selectors`, in order, takes it. Focus that
 * moved to something outside the box is left alone. Spread the result on the box.
 */
export function useRefocusOnSwap<T extends HTMLElement>(
  key: string,
  selectors: readonly string[],
): {
  ref: RefObject<T | null>;
  onFocus: () => void;
  onBlur: (event: FocusEvent) => void;
} {
  const ref = useRef<T>(null);
  const hadFocus = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the controls change (`key`).
  useLayoutEffect(() => {
    if (!hadFocus.current || document.activeElement !== document.body) return;
    const target = selectors
      .map((selector) => ref.current?.querySelector<HTMLElement>(selector))
      .find(Boolean);
    target?.focus({ preventScroll: true });
  }, [key]);
  return {
    ref,
    onFocus: () => {
      hadFocus.current = true;
    },
    // Focus that went to another element left; focus with nowhere to go (a removed control) didn't.
    onBlur: (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && !ref.current?.contains(next)) {
        hadFocus.current = false;
      }
    },
  };
}
