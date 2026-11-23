"use client";

import { useState } from "react";
import { adminRetryMoneyMovement } from "@/app/admin/actions";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { toast } from "@/components/ui/toast";
import { usePendingAction } from "@/components/ui/use-pending-action";
import { RETRY_COPY } from "@/lib/admin/copy";
import type { Currency, MoneyMovementKind } from "@/lib/domain/values";
import { formatMoney } from "@/lib/format";
import { useFocusHandOff } from "./use-focus-hand-off";
import { useSheetOpenings } from "./use-sheet-openings";

/**
 * What a Retry needs: the movement, its kind, its amount in its currency, its license's code (the button's name) and
 * the creator the sheet names.
 */
export type RetryableMovement = {
  id: string;
  kind: MoneyMovementKind;
  amountCents: number;
  currency: Currency;
  licenseCode: string;
  creatorHandle: string;
};

/**
 * A failed money movement's Retry (05 §7 callout 9; 02 §6.1; owner answers Q-208, Q-211): a secondary sm button reading
 * "Retry", named by its kind and license for screen readers ("Retry take-back for CL-7K3M-9QXA"), disabled while its
 * retry runs. It asks first in a ConfirmSheet that mounts at the first opening and starts afresh at each; the focus
 * comes back to the button when the sheet closes, or, once a retry that worked removed it with the failure, to its
 * row's code or its list's heading (useFocusHandOff). The table renders each cell twice (stacked and wide), so each copy
 * has its own sheet.
 */
export function RetryMoneyMovementButton({
  movement,
}: {
  movement: RetryableMovement;
}) {
  const { trigger, opening, onCloseAutoFocus } =
    useFocusHandOff<HTMLButtonElement>();
  const sheet = useSheetOpenings();
  const [pending, run] = usePendingAction();
  return (
    <>
      <Button
        ref={trigger}
        variant="secondary"
        size="sm"
        aria-label={RETRY_COPY.kind[movement.kind].actionLabel(
          movement.licenseCode,
        )}
        disabled={pending}
        onClick={() => {
          opening();
          sheet.show();
        }}
      >
        {RETRY_COPY.action}
      </Button>
      {sheet.mounted ? (
        <RetrySheet
          key={sheet.openings}
          movement={movement}
          open={sheet.open}
          onOpenChange={sheet.onOpenChange}
          pending={pending}
          run={run}
          onCloseAutoFocus={onCloseAutoFocus}
        />
      ) : null}
    </>
  );
}

/**
 * The Retry sheet (owner answers Q-208, Q-211): "Retry this {refund · take-back · transfer}?", what it tries again, a
 * primary Retry (it takes nothing away) and Cancel. While "Retrying…" runs it can't be closed. Done: closed, and "Retry
 * done."; nothing left to do (the movement went through or was canceled meanwhile): closed, and "Nothing to retry.".
 * Failed again: the code in an error Banner, kept open; another retry holds it, or Stripe didn't answer: its Banner.
 * Each answer remounts the Banner, so a repeat is announced again.
 */
function RetrySheet({
  movement,
  open,
  onOpenChange,
  pending,
  run,
  onCloseAutoFocus,
}: {
  movement: RetryableMovement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  run: ReturnType<typeof usePendingAction>[1];
  onCloseAutoFocus: (event: Event) => void;
}) {
  const [error, setError] = useState<{ text: string; n: number } | null>(null);
  const words = RETRY_COPY.kind[movement.kind];
  const show = (text: string) =>
    setError((last) => ({ text, n: (last?.n ?? 0) + 1 }));

  async function retry() {
    const result = await run(() =>
      adminRetryMoneyMovement({ movementId: movement.id }),
    );
    // Null: Next is on its way to sign-in.
    if (result === null) return;
    if (!result.ok) {
      show(result.error.message);
      return;
    }
    const step = result.data;
    switch (step.outcome) {
      case "succeeded":
        toast(RETRY_COPY.toast);
        onOpenChange(false);
        return;
      case "noop":
        toast(RETRY_COPY.nothingToRetry);
        onOpenChange(false);
        return;
      case "failed":
        show(RETRY_COPY.failed(step.code));
        return;
      case "in_progress":
        show(RETRY_COPY.inProgress);
        return;
      case "transient":
        show(RETRY_COPY.transient);
        return;
    }
  }

  return (
    <ConfirmSheet
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      title={words.title}
      description={words.body(
        formatMoney(movement.amountCents, movement.currency),
        movement.creatorHandle,
      )}
      confirmLabel={RETRY_COPY.confirm}
      confirmVariant="primary"
      confirmLoading={pending}
      confirmLoadingLabel={RETRY_COPY.pending}
      onConfirm={(event) => {
        event.preventDefault();
        void retry();
      }}
      cancelLabel={RETRY_COPY.cancel}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {error ? (
        <Banner key={error.n} tone="error" className="mt-4">
          {error.text}
        </Banner>
      ) : null}
    </ConfirmSheet>
  );
}
