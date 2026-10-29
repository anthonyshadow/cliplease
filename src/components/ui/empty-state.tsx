import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 04 §9.24: centered, no illustration. `title` is two-tone `title-2` (pass the second half in a `text-ink-2` span);
 * at most one primary plus one tertiary action. Copy comes from 04 §11.9. Without a title it is the body alone, under a
 * page title that already says it (the Inbox).
 */
export function EmptyState({
  title,
  description,
  actions,
  as: Heading = "h2",
  headingId,
  className,
}: {
  title?: ReactNode;
  /** The title's heading level: h1 when the empty state is the whole page (the Inbox placeholder). */
  as?: "h1" | "h2";
  /** The heading's id, for a page that moves the focus to its title (it then takes a programmatic focus). */
  headingId?: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-[26rem] flex-col items-center gap-3 py-16 text-center",
        className,
      )}
    >
      {title ? (
        <Heading
          id={headingId}
          tabIndex={headingId ? -1 : undefined}
          className="text-title-2 text-ink outline-none"
        >
          {title}
        </Heading>
      ) : null}
      {description ? (
        <p className="text-callout text-ink-2">{description}</p>
      ) : null}
      {actions ? (
        // Full width so a phone's primary can span it (07 D149); other actions keep their own width, centered.
        <div className="mt-3 flex w-full flex-col items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
