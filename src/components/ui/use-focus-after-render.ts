import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Moves the focus to what `target` returns once the render a call asks for has committed: an action's result, so screen
 * readers hear it where it now shows (05 §6.3). Returns the function to call after the result's state is set.
 */
export function useFocusAfterRender(
  target: () => HTMLElement | null | undefined,
): () => void {
  const [turn, setTurn] = useState(0);
  const latest = useRef(target);
  latest.current = target;
  useEffect(() => {
    if (turn > 0) latest.current()?.focus();
  }, [turn]);
  return useCallback(() => setTurn((t) => t + 1), []);
}
