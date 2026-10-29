"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** How often a page that is about to change on the server refreshes, and how many times (02 §4.1, §8.3): every 3 s for 30 s. */
export const REFRESH_EVERY_MS = 3_000;
export const REFRESH_TIMES = 10;

/**
 * While `active`, refreshes the page every 3 s, 10 times (02 §8.3; 05 §4.3 "Finishing checkout…"): true once the last
 * refresh has run, so the message can say what to do next. The page's next state usually comes first: `active` turns
 * false (or the caller unmounts) and the refreshes stop.
 */
export function useCheckingRefresh(active: boolean): boolean {
  const router = useRouter();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!active || done) return;
    let left = REFRESH_TIMES;
    const timer = setInterval(() => {
      router.refresh();
      left -= 1;
      if (left === 0) {
        clearInterval(timer);
        setDone(true);
      }
    }, REFRESH_EVERY_MS);
    return () => clearInterval(timer);
  }, [router, active, done]);
  return done;
}
