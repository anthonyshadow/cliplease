import { useEffect, useRef, useState } from "react";

/**
 * Whether a post's image failed (04 §9.12): true from the start when there is no src, and once the image fires
 * onError, so the caller shows its failed state instead of a broken image (01 J3.10). An image that failed before
 * hydration fired no onError, so the mount checks it too. Spread `imageProps` on the <img>, and key the component on
 * the src (or its version) so a new one tries again.
 */
export function useImageFailed(src: string | null) {
  const [failed, setFailed] = useState(src === null);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  return { failed, imageProps: { ref, onError: () => setFailed(true) } };
}
