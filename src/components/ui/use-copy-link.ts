import { useEffect, useState } from "react";

/** "copied" for 2 s after a copy; "manual" when there is no clipboard. `id` changes on every press. */
type CopyStatus = { kind: "idle" | "copied" | "manual"; id: number };

/** 04 §9.25's words for a copy: announced, and shown when there is no clipboard. */
export const COPY_LINK_COPY = {
  copied: "Link copied",
  manual: "Press and hold to copy",
} as const;

/**
 * Copying a link (04 §9.25, §9.27): `copy` writes `url` to the clipboard and reports "copied" for 2 s; without a
 * clipboard it reports "manual" (the caller shows the link selected, with "Press and hold to copy"). `id` changes on
 * every press, so a second copy restarts the 2 s and is announced again.
 */
export function useCopyLink(url: string) {
  const [status, setStatus] = useState<CopyStatus>({ kind: "idle", id: 0 });
  useEffect(() => {
    if (status.kind !== "copied") return;
    const timer = setTimeout(
      () => setStatus((s) => ({ kind: "idle", id: s.id })),
      2000,
    );
    return () => clearTimeout(timer);
  }, [status]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setStatus((s) => ({ kind: "copied", id: s.id + 1 }));
    } catch {
      setStatus((s) => ({ kind: "manual", id: s.id + 1 }));
    }
  };
  return { status, copy };
}
