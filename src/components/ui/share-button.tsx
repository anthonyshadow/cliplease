"use client";

import { Share } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { useClientValue } from "./use-client-value";

/**
 * "Share…" (01 J6.2; 05 §6.5 callout 55): a secondary button opening the system share sheet with `url`, only where the
 * browser has one (`navigator.share`). Read after hydration (Node has a global `navigator` too); a cancelled share
 * says nothing.
 */
export function ShareButton({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const canShare = useClientValue(
    () => typeof navigator.share === "function",
    false,
  );
  if (!canShare) return null;
  return (
    <Button
      variant="secondary"
      className={cn("self-start", className)}
      onClick={() => navigator.share({ url }).catch(() => {})}
    >
      <Share aria-hidden size={16} strokeWidth={2} />
      Share…
    </Button>
  );
}
