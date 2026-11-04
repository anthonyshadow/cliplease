import { useEffect } from "react";

/**
 * While `dirty`, closing or reloading the tab asks first (05 §6.9 States: the beforeunload guard). Each editor has its
 * own listener, so two on one page (the Prices section) each keep theirs until they are clean.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers show the dialog only when returnValue is set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
