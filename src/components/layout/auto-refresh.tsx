"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { REFRESH_EVERY_MS, REFRESH_TIMES } from "./refreshing-message";

/** How often a waiting page refreshes on its own (01 J7.17; 05 §4.3, §6.3). */
export const AUTO_REFRESH_EVERY_MS = 30_000;
/** A focus and a visibilitychange from one return to the tab count once. */
const SAME_RETURN_MS = 1_000;

/**
 * Refreshes the page (router.refresh(): the server components re-render, client state stays) every 30 s while the tab
 * is visible, and when the viewer comes back to it: window focus, or the document becoming visible (iOS Safari doesn't
 * always fire focus). A hidden tab skips its ticks and refreshes on that return instead (owner answer Q-130: nobody
 * sees it). `onRefresh` runs just before each refresh; `restart` starts the 30 s over (P18: the inbox keeps a settled
 * row until the next refresh), ending a burst. One refresher per page; `burst` (/r while auto-approve runs, 05 §4.3):
 * every 3 s for 30 s first.
 */
export function useAutoRefresh({
  onRefresh,
  burst = false,
}: {
  onRefresh?: () => void;
  burst?: boolean;
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
    const tick = () => {
      if (document.visibilityState !== "hidden") refresh();
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    // The 30 s pace from now: from the start, after a burst, and on restart.
    const steady = () => {
      clearInterval(timer);
      timer = setInterval(tick, AUTO_REFRESH_EVERY_MS);
    };
    if (burst) {
      let left = REFRESH_TIMES;
      timer = setInterval(() => {
        tick();
        left -= 1;
        if (left === 0) steady();
      }, REFRESH_EVERY_MS);
    } else {
      steady();
    }
    startOver.current = steady;
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      startOver.current = () => {};
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [router, burst]);
  const restart = useCallback(() => startOver.current(), []);
  return { restart };
}

/** useAutoRefresh for a page with nothing to add: /r while the request waits, in a burst while auto-approve runs. */
export function AutoRefresh({ burst }: { burst?: boolean } = {}): null {
  useAutoRefresh({ burst });
  return null;
}
