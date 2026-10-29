"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

/** How often a waiting page refreshes on its own (01 J7.17; 05 §4.3, §6.3). */
export const AUTO_REFRESH_EVERY_MS = 30_000;
/** A focus and a visibilitychange from one return to the tab count once. */
const SAME_RETURN_MS = 1_000;

/**
 * Refreshes the page (router.refresh(): the server components re-render, client state stays) every 30 s, and when the
 * viewer comes back to the tab: window focus, or the document becoming visible (iOS Safari doesn't always fire focus).
 * `onRefresh` runs just before each refresh; `restart` starts the 30 s over (P18: the inbox keeps a settled row until
 * the next refresh). One refresher per page.
 */
export function useAutoRefresh({
  onRefresh,
}: {
  onRefresh?: () => void;
} = {}): { restart: () => void } {
  const router = useRouter();
  const latest = useRef(onRefresh);
  useEffect(() => {
    latest.current = onRefresh;
  });
  const startOver = useRef(() => {});
  useEffect(() => {
    let last = 0;
    const refresh = () => {
      last = Date.now();
      latest.current?.();
      router.refresh();
    };
    const back = () => {
      if (Date.now() - last >= SAME_RETURN_MS) refresh();
    };
    const visible = () => {
      if (document.visibilityState === "visible") back();
    };
    let timer = setInterval(refresh, AUTO_REFRESH_EVERY_MS);
    startOver.current = () => {
      clearInterval(timer);
      timer = setInterval(refresh, AUTO_REFRESH_EVERY_MS);
    };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      startOver.current = () => {};
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [router]);
  const restart = useCallback(() => startOver.current(), []);
  return { restart };
}

/** useAutoRefresh for a page with nothing to add: /r while the request waits. */
export function AutoRefresh(): null {
  useAutoRefresh();
  return null;
}
