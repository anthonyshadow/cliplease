"use client";

import { useEffect, useRef } from "react";

/**
 * A refused request refreshes the page, and when the video can't take a request any more the pressed button is gone with
 * the options: focus moves to the visible AvailabilityNotice, the page's copy for this tier. First in the page's grid in
 * both branches, so this ref survives the refresh. A page that loads reserved moves nothing. Renders nothing.
 */
export function AvailabilityFocus({ sellable }: { sellable: boolean }) {
  const wasSellable = useRef(sellable);
  useEffect(() => {
    if (wasSellable.current && !sellable) {
      const notices = document.querySelectorAll<HTMLElement>(
        "[data-availability-notice]",
      );
      [...notices].find((n) => n.getClientRects().length > 0)?.focus();
    }
    wasSellable.current = sellable;
  }, [sellable]);
  return null;
}
