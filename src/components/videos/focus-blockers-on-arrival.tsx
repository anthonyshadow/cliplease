"use client";

import { useEffect } from "react";
import { BLOCKERS_HEADING_ID } from "@/lib/videos/review";

/**
 * Opened at `#publish-blockers` (the Videos Menu's Turn on a blocker refused, 05 §6.8): the focus lands on "Before you can
 * publish", and the fragment goes, so a reload or Back doesn't move it again.
 */
export function FocusBlockersOnArrival() {
  useEffect(() => {
    if (window.location.hash !== `#${BLOCKERS_HEADING_ID}`) return;
    document.getElementById(BLOCKERS_HEADING_ID)?.focus();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  }, []);
  return null;
}
