"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useUploads } from "@/lib/upload/upload-store";

/**
 * The Review is read on the server: when a cover picked on this page finishes storing, fetch the page again, so "Add a
 * cover image for buyers" goes and the video summary shows the new cover. A cover that finished before this page opened
 * changes nothing.
 */
export function RefreshOnCoverDone({ videoId }: { videoId: string }) {
  const router = useRouter();
  const phase = useUploads().covers[videoId]?.phase;
  const last = useRef(phase);
  useEffect(() => {
    const before = last.current;
    last.current = phase;
    if (phase === "done" && before !== "done") router.refresh();
  }, [phase, router]);
  return null;
}
