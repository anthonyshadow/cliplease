import { useEffect } from "react";

function warnBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  // Older browsers show the dialog only when returnValue is set.
  event.returnValue = "";
}

/** While `dirty`, closing or reloading the tab asks first (05 §6.9 States: the beforeunload guard). */
export function useUnsavedChangesGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);
}
