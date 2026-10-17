import { Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Informational block, not status (04 §9.21): `fill` box, 20 px `ink-2` icon, callout text.
 * Holds text and `link` actions only, never a bordered control (04 §2.2-8).
 */
export function Notice({
  title,
  icon: Icon = Info,
  action,
  className,
  children,
}: {
  title?: ReactNode;
  icon?: LucideIcon;
  /** A `Button variant="link"`. */
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex gap-3 rounded-md bg-fill p-4", className)}>
      <Icon aria-hidden className="mt-0.5 shrink-0 text-ink-2" />
      <div className="flex flex-col gap-1 text-callout">
        {title ? <p className="font-semibold text-ink">{title}</p> : null}
        {children ? <div className="text-ink-2">{children}</div> : null}
        {action ? <div>{action}</div> : null}
      </div>
    </div>
  );
}
