"use client";

import { AlertDialog } from "radix-ui";
import { type MouseEvent, type ReactNode, useRef } from "react";
import { Button, type ButtonLoadingProps } from "./button";
import {
  CLOSE_BUTTON_CLASS,
  CloseGlyph,
  Grabber,
  SCRIM_CLASS,
  SHEET_BODY_CLASS,
  SHEET_CLASS,
  SHEET_FOOTER_CLASS,
  SHEET_HEADER_CLASS,
} from "./sheet";

/** While the confirm action runs it shows `confirmLoadingLabel` ("Revoking…"), so the label is required with it. */
type ConfirmLoading =
  | { confirmLoading?: false; confirmLoadingLabel?: undefined }
  | { confirmLoading: boolean; confirmLoadingLabel: string };

export type ConfirmSheetProps = {
  /** The element that opens the sheet (wrapped with AlertDialog Trigger `asChild`). */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  /** Read before the buttons: linked by aria-describedby. */
  description: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  confirmVariant?: "destructive" | "primary" | "secondary";
  onConfirm?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** The safe action, e.g. "Keep license", "Not now". */
  cancelLabel: string;
  /** `primary` only for TurnOffAutoRenewSheet, whose safe action is the primary (04 §9.22). */
  cancelVariant?: "secondary" | "primary";
} & ConfirmLoading;

/**
 * 04 §9.22: Sheet visuals on Radix AlertDialog (`role="alertdialog"`). The safe button gets the initial focus. The
 * only place a `destructive` Button appears. Esc, the close button and the safe button dismiss; a scrim tap doesn't.
 * `onConfirm` runs first; call `event.preventDefault()` in it to keep the sheet open while work runs (with
 * `confirmLoading`), then close it through `open` / `onOpenChange`.
 */
export function ConfirmSheet({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  confirmVariant = "destructive",
  confirmLoading = false,
  confirmLoadingLabel,
  onConfirm,
  cancelLabel,
  cancelVariant = "secondary",
}: ConfirmSheetProps) {
  // Two Cancel parts (the close button and the safe button) share Radix's one cancel ref, so the initial focus is
  // set here explicitly rather than left to whichever attached last.
  const safeRef = useRef<HTMLButtonElement>(null);
  const loading: ButtonLoadingProps =
    confirmLoadingLabel === undefined
      ? {}
      : { loading: confirmLoading, loadingLabel: confirmLoadingLabel };
  const confirm = (
    <AlertDialog.Action asChild>
      <Button variant={confirmVariant} {...loading} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </AlertDialog.Action>
  );
  const safe = (
    <AlertDialog.Cancel asChild>
      <Button ref={safeRef} variant={cancelVariant}>
        {cancelLabel}
      </Button>
    </AlertDialog.Cancel>
  );
  // The footer takes the primary first (stacked on mobile, reversed to the right from md).
  const safeIsPrimary = cancelVariant === "primary";
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? (
        <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>
      ) : null}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={SCRIM_CLASS} />
        <AlertDialog.Content
          className={SHEET_CLASS}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            safeRef.current?.focus({ preventScroll: true });
          }}
        >
          <Grabber />
          <div className={SHEET_HEADER_CLASS}>
            <AlertDialog.Title className="min-w-0 flex-1 pt-2.5 text-title-2 text-ink">
              {title}
            </AlertDialog.Title>
            <AlertDialog.Cancel
              aria-label="Close"
              className={CLOSE_BUTTON_CLASS}
            >
              <CloseGlyph />
            </AlertDialog.Cancel>
          </div>
          <div className={SHEET_BODY_CLASS}>
            <AlertDialog.Description className="text-body text-ink">
              {description}
            </AlertDialog.Description>
            {children}
          </div>
          <div className={SHEET_FOOTER_CLASS}>
            {safeIsPrimary ? safe : confirm}
            {safeIsPrimary ? confirm : safe}
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
