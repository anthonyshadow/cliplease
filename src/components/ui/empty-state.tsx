import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 04 §9.24: centered, no illustration. `title` is two-tone `title-2` (pass the second half in a `text-ink-2` span);
 * at most one primary plus one tertiary action. Copy comes from 04 §11.9.
 */
export function EmptyState({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex max-w-[26rem] flex-col items-center gap-3 py-16 text-center",
        className,
      )}
    >
      <h2 className="text-title-2 text-ink">{title}</h2>
      {description ? (
        <p className="text-callout text-ink-2">{description}</p>
      ) : null}
      {actions ? (
        <div className="mt-3 flex flex-col items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
