"use client";

import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { type CountdownTone, countdownState } from "@/lib/countdown";
import { formatDeadline } from "@/lib/format";
import { cn } from "@/lib/utils";
import { pillVariants } from "./status-pill";

type Snapshot = { label: string; tone: CountdownTone; title: string };

/**
 * "Expires in 5 h 12 min" (04 §9.10). The clock and the viewer's zone are read only after mount, so server and
 * first client render match (02 §4.4): until then the pill keeps its frame and the <time> stays empty.
 * No aria-live. At zero it keeps "Expires in 0 min" until the server confirms the expiry.
 */
export function CountdownChip({
  expiresAt,
  srPrefix,
  tone,
  className,
}: {
  /** ISO 8601 instant. */
  expiresAt: string;
  /** Read before the time by screen readers only, e.g. "Waiting for you" on creator views (04 §9.9). */
  srPrefix?: string;
  /** "neutral" keeps the neutral tone at every remaining time (the buyer's /r page). */
  tone?: "neutral";
  className?: string;
}) {
  const expiresAtMs = Date.parse(expiresAt);
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    // The deadline tooltip is fixed for this expiry: read the zone and format it once, not on every tick.
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const title = formatDeadline(new Date(expiresAtMs), timeZone);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const { label, tone, nextTickMs } = countdownState(
        expiresAtMs,
        Date.now(),
      );
      // Keep the same object when nothing visible changed, so React skips the render.
      setSnap((prev) =>
        prev?.label === label && prev.tone === tone && prev.title === title
          ? prev
          : { label, tone, title },
      );
      if (nextTickMs !== null) timer = setTimeout(tick, nextTickMs);
    };
    tick();
    return () => clearTimeout(timer);
  }, [expiresAtMs]);

  const resolvedTone = tone ?? snap?.tone ?? "neutral";
  return (
    <span className={cn(pillVariants({ tone: resolvedTone }), className)}>
      <Clock aria-hidden size={12} strokeWidth={2.5} className="shrink-0" />
      {srPrefix ? <span className="sr-only">{`${srPrefix}, `}</span> : null}
      <time dateTime={expiresAt} title={snap?.title}>
        {snap?.label ?? ""}
      </time>
    </span>
  );
}
