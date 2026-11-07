"use client";

import {
  COPY_PILL_COPY,
  CopyPill,
  CopyStatusLine,
  useSelectWhenManual,
} from "@/components/ui/copy-link-field";
import { useCopyLink } from "@/components/ui/use-copy-link";
import { cn } from "@/lib/utils";

/** CopyLinkField's pill, its fill one step off what it sits on (04 §2.2-8). */
const PILL_ON = { surface: "bg-fill", fill: "bg-surface" } as const;

/**
 * A short text and its Copy pill (05 §4.4 callouts 4 and 7; 04 §10.2: the license code and the credit line on /l). 04's
 * borderless pill over 05's "Button secondary sm", which a Notice's `fill` may not hold (04 §2.2-8, §9.21). The pill
 * wraps under a text too long to share its line. Without a clipboard the text is selected, with "Press and hold to
 * copy". `name` ends the button's name ("Copy license code"), so the copies on one page tell themselves apart. The pill
 * reads "Copied" for 2 s, and that is what is announced (05 §4.4's interaction notes).
 */
export function CopyText({
  text,
  name,
  on,
  className,
  textClassName,
}: {
  text: string;
  name: string;
  /** What the row sits on: a `surface` card or a `fill` Notice. */
  on: keyof typeof PILL_ON;
  className?: string;
  textClassName?: string;
}) {
  const { status, copy } = useCopyLink(text);
  const copied = status.kind === "copied";
  const label = copied ? COPY_PILL_COPY.copied : COPY_PILL_COPY.copy;
  const textRef = useSelectWhenManual(status);

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span
          ref={textRef}
          className={cn("min-w-0 wrap-anywhere select-all", textClassName)}
        >
          {text}
        </span>
        <CopyPill
          copied={copied}
          onClick={copy}
          aria-label={`${label} ${name}`}
          className={PILL_ON[on]}
        />
      </div>
      <CopyStatusLine status={status} copiedText={COPY_PILL_COPY.copied} />
    </div>
  );
}
