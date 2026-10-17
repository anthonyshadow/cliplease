"use client";

import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// 04 §9.22. Below md a bottom sheet with a grabber; from md a centered 30rem dialog. Only the body scrolls, so the
// title, the close button and the footer stay on screen in short windows and landscape phones.
export const SCRIM_CLASS =
  "fixed inset-0 z-50 bg-scrim animate-fade-in data-[state=closed]:animate-fade-out";
export const SHEET_CLASS =
  "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-lg border border-transparent bg-surface-raised text-ink shadow-overlay safe-area-bar animate-sheet-in data-[state=closed]:animate-sheet-out md:inset-x-auto md:bottom-auto md:top-1/2 md:left-1/2 md:max-h-[calc(100dvh-4rem)] md:w-[calc(100%-2*var(--gutter))] md:max-w-[30rem] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:animate-dialog-in md:data-[state=closed]:animate-fade-out";
export const SHEET_HEADER_CLASS =
  "flex shrink-0 items-start gap-3 px-4 pt-2 md:px-8 md:pt-8";
export const SHEET_BODY_CLASS =
  "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 text-body md:px-8";
export const SHEET_FOOTER_CLASS =
  "flex shrink-0 flex-col gap-3 px-4 pb-4 *:w-full md:flex-row-reverse md:justify-start md:px-8 md:pb-8 md:*:w-auto";

/** The header's 44 px close control: a 20 px `X` in `ink-2` on a 32 px `fill` circle (ConfirmSheet shares it). */
export const CLOSE_BUTTON_CLASS =
  "-mr-1.5 flex size-11 shrink-0 items-center justify-center rounded-full";

export function CloseGlyph() {
  return (
    <span className="flex size-8 items-center justify-center rounded-full bg-fill text-ink-2">
      <X aria-hidden />
    </span>
  );
}

/** The decorative 36 × 5 grabber (no drag-to-dismiss). */
export function Grabber() {
  return (
    <span
      aria-hidden
      className="mx-auto mt-2 block h-[5px] w-9 shrink-0 rounded-full bg-hairline-strong md:hidden"
    />
  );
}

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

/**
 * Portaled content with the header (title + 44 px close button), a scrolling body and an optional footer.
 * Footer order: mobile stacked with the primary first in the DOM; desktop right-aligned with the primary last
 * (pass the buttons primary-first and they are reversed from md).
 */
export function SheetContent({
  title,
  description,
  footer,
  className,
  children,
}: {
  /** Required: it names the dialog. `title-2`; two-tone allowed. */
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className={SCRIM_CLASS} />
      <Dialog.Content
        className={cn(SHEET_CLASS, className)}
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <Grabber />
        <div className={SHEET_HEADER_CLASS}>
          <div className="flex min-w-0 flex-1 flex-col gap-1 pt-2.5">
            <Dialog.Title className="text-title-2 text-ink">
              {title}
            </Dialog.Title>
            {description ? (
              <Dialog.Description className="text-callout text-ink-2">
                {description}
              </Dialog.Description>
            ) : null}
          </div>
          <Dialog.Close aria-label="Close" className={CLOSE_BUTTON_CLASS}>
            <CloseGlyph />
          </Dialog.Close>
        </div>
        {children ? <div className={SHEET_BODY_CLASS}>{children}</div> : null}
        {footer ? <div className={SHEET_FOOTER_CLASS}>{footer}</div> : null}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
