import { useEffect, useState } from "react";
import { BLOCKERS_HEADING_ID } from "@/lib/videos/review";

/**
 * Moves the focus to "Before you can publish" (05 §6.5 callout 51) once the refreshed page lists it, for Review's
 * Publish and the video page's Turn off / Turn on. Call the setter with "refused" after a blocker refused: the focus
 * goes there as soon as the list shows. With "turned_off" after a Turn off: once the page shows the video Off, the focus
 * goes there if Turn on is blocked, else it stays on the button. null forgets the wait (a new press).
 */
export function useBlockersFocus(blocked: boolean, live = false) {
  const [awaiting, setAwaiting] = useState<"refused" | "turned_off" | null>(
    null,
  );
  useEffect(() => {
    const ready =
      awaiting === "refused" ? blocked : awaiting === "turned_off" && !live;
    if (!ready) return;
    if (blocked) document.getElementById(BLOCKERS_HEADING_ID)?.focus();
    setAwaiting(null);
  }, [awaiting, blocked, live]);
  return setAwaiting;
}
