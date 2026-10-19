"use client";

import { useEffect } from "react";

/**
 * 05 §6.2: a callback's ?connected= and ?error= render once. Right after the page mounts this drops them from the
 * address (when there are any), so a reload repeats neither the toast nor the Banner. It runs in a timeout because Next 16 hooks
 * history.replaceState in the router's own mount effect, after a child's (P05: an earlier call is undone), and before
 * anyone can press a button, because a URL change during a Server Action can cancel it (P05, PROGRESS).
 */
export function StripConnectParams() {
  useEffect(() => {
    const timer = setTimeout(() => {
      const url = new URL(window.location.href);
      if (
        !url.searchParams.has("connected") &&
        !url.searchParams.has("error")
      ) {
        return;
      }
      url.searchParams.delete("connected");
      url.searchParams.delete("error");
      window.history.replaceState(
        null,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
