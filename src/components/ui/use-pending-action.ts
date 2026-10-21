import { useState } from "react";
import type { ActionResult } from "@/lib/result";
import { runAction } from "./run-action";

/**
 * runAction with the flag for the Button's `loading`: `run` resolves to runAction's result (null while Next redirects).
 * The Button ignores taps while it is loading, and React renders the first tap's state before the next one.
 */
export function usePendingAction() {
  const [pending, setPending] = useState(false);
  async function run<T>(
    action: () => Promise<ActionResult<T>>,
  ): Promise<ActionResult<T> | null> {
    setPending(true);
    const result = await runAction(action);
    setPending(false);
    return result;
  }
  return [pending, run] as const;
}
