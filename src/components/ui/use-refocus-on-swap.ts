import {
  type FocusEvent,
  type RefObject,
  useLayoutEffect,
  useRef,
} from "react";

/**
 * Keeps keyboard focus in a box whose controls swap (an upload's states, a cover picked): when focus was inside and the
 * focused control went away (focus fell to the page), the first match of `selectors`, in order, takes it. Focus that
 * moved to something outside the box, or to the page on a click, is left alone. Spread the result on the box.
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
    // Focus that went to another element left. Focus with nowhere to go either fell from a removed control (it didn't
    // leave) or went to the page on a click elsewhere (it left): told apart once the commit that may remove the control
    // is over, by whether the blurred control is still in the page and focus is still outside the box. A window or tab
    // switch keeps focus on the control, so the box still has it.
    onBlur: (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node) {
        if (!ref.current?.contains(next)) hadFocus.current = false;
        return;
      }
      const blurred = event.target;
      queueMicrotask(() => {
        if (
          blurred instanceof Node &&
          blurred.isConnected &&
          !ref.current?.contains(document.activeElement)
        ) {
          hadFocus.current = false;
        }
      });
    },
  };
}
