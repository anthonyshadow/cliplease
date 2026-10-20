// The Screen Wake Lock while an original uploads (07 D80, 04 §9.26), so a phone's screen doesn't sleep mid-upload.
// Feature-detected and never throws; `nav` and `doc` are passed in for tests.

type WakeLockSentinelLike = { release: () => Promise<void> };
type NavigatorLike = {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
};
type DocumentLike = Pick<
  Document,
  "visibilityState" | "addEventListener" | "removeEventListener"
>;

/**
 * Requests the screen lock where `navigator.wakeLock` exists and asks again whenever the page becomes visible (the
 * browser drops it when the page is hidden), until `release()`. A refused request is ignored.
 */
export function holdScreenWakeLock({
  nav,
  doc,
}: {
  nav: NavigatorLike;
  doc: DocumentLike;
}): { release: () => void } {
  const api = nav.wakeLock;
  if (!api) return { release: () => undefined };
  let released = false;
  let sentinel: WakeLockSentinelLike | null = null;

  const acquire = () => {
    api
      .request("screen")
      .then((lock) => {
        if (released) void lock.release().catch(() => undefined);
        else sentinel = lock;
      })
      .catch(() => undefined);
  };
  const onVisibility = () => {
    if (!released && doc.visibilityState === "visible") acquire();
  };

  acquire();
  doc.addEventListener("visibilitychange", onVisibility);
  return {
    release: () => {
      if (released) return;
      released = true;
      doc.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    },
  };
}
