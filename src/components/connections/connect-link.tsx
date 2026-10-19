"use client";

import { type MouseEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** A navigation that hasn't left after this long was stopped (Esc, a failed request): the link works again. */
const PRESSED_MS = 10_000;

/**
 * Connect / Reconnect (04 §9.17, §11.7; owner answer Q-19): a plain link styled as a Button, a full navigation to the
 * start route, never prefetched (a prefetch would start a connect). Once pressed it shows Button's loading layer
 * ("Connecting…", width locked, further presses ignored, 04 §9.2) until the browser leaves; a page restored from the
 * back-forward cache, or one still here after 10 s, shows the label again.
 */
export function ConnectLink({
  href,
  label,
  ariaLabel,
  variant,
}: {
  href: string;
  label: string;
  /** The accessible name before it is pressed, e.g. "Connect Demo"; pressed, it is "Connecting…". */
  ariaLabel?: string;
  variant: "primary" | "secondary";
}) {
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    if (!pressed) return;
    const reset = () => setPressed(false);
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) reset();
    };
    window.addEventListener("pageshow", restore);
    const timer = setTimeout(reset, PRESSED_MS);
    return () => {
      window.removeEventListener("pageshow", restore);
      clearTimeout(timer);
    };
  }, [pressed]);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // A new tab or window leaves this page as it was.
    const modified =
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.button === 0 && !modified) setPressed(true);
  };
  return (
    <Button
      asChild
      variant={variant}
      size="sm"
      loading={pressed}
      loadingLabel="Connecting…"
    >
      <a
        href={href}
        aria-label={pressed ? undefined : ariaLabel}
        onClick={onClick}
      >
        {label}
      </a>
    </Button>
  );
}
