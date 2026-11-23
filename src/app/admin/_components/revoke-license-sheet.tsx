"use client";

import { useState } from "react";
import { adminRevokeLicense } from "@/app/admin/actions";
import { ConfirmSheet } from "@/components/ui/confirm-sheet";
import { toast } from "@/components/ui/toast";
import { usePendingAction } from "@/components/ui/use-pending-action";
import { REVOKE_COPY } from "@/lib/admin/copy";
import { LICENSE_REVOKED_REASON_LABELS } from "@/lib/admin/labels";
import {
  LICENSE_REVOKED_REASONS,
  type RevokedReason,
} from "@/lib/domain/values";
import { formatMoney } from "@/lib/format";
import type { AdminLicenseAction } from "./license-row-action";
import { ReasonNoteFields, useReasonField } from "./reason-note-fields";

/**
 * What the revoke does with the money, before the confirm (05 §7 callout 10; 07 D86; owner answer Q-209): Payment
 * reversed refunds nothing; otherwise the buyer's total comes back, and the creator's share is taken back when it was
 * sent, or its payout canceled when it wasn't yet (pending or failed); with no transfer at all, the refund alone.
 */
function revokeBody(
  license: AdminLicenseAction,
  reason: RevokedReason | "",
): string {
  if (reason === "payment_reversed") return REVOKE_COPY.paymentReversedBody;
  const total = formatMoney(license.amountTotalCents, license.currency);
  const price = formatMoney(license.licensePriceCents, license.currency);
  switch (license.transferStatus) {
    case "succeeded":
      return REVOKE_COPY.takeBackBody(total, price, license.creatorHandle);
    case "pending":
    case "failed":
      return REVOKE_COPY.cancelPayoutBody(total, price, license.creatorHandle);
    default:
      return REVOKE_COPY.refundOnlyBody(total);
  }
}

/**
 * The Revoke sheet (05 §7 callout 10; 04 §9.22, §11.10; 07 D86; owner answers Q-207, Q-209): the money sentence (it
 * switches live to Payment reversed's), a reason to choose ("Choose a reason." until one is) and an optional note for
 * admins; Keep license takes the first focus; the destructive confirm reads Revoke and refund, or Revoke for Payment
 * reversed. While "Revoking…" runs it can't be closed. A failure shows the error Banner and keeps everything: a payout
 * in flight reads Q-207's sentence. Done: closed, and the toast; already revoked by another admin: closed with no
 * toast, the refreshed row shows the truth.
 */
export function RevokeLicenseSheet({
  license,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  license: AdminLicenseAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { field, reason, note, showReasonError, chosen } = useReasonField(
    LICENSE_REVOKED_REASONS,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = usePendingAction();

  async function revoke() {
    setError(null);
    const why = chosen();
    if (why === null) return;
    const result = await run(() =>
      adminRevokeLicense({ licenseId: license.id, reason: why, note }),
    );
    // Null: Next is on its way to sign-in.
    if (result === null) return;
    if (!result.ok) {
      const reasonMessage = result.error.fields?.reason?.[0];
      if (reasonMessage) showReasonError(reasonMessage);
      else setError(result.error.message);
      return;
    }
    const { outcome } = result.data;
    if (outcome === "transfer_in_progress") {
      // The action knows the license only by its id: the row names the creator.
      setError(REVOKE_COPY.inProgress(license.creatorHandle));
      return;
    }
    if (outcome === "revoked") toast(REVOKE_COPY.toast);
    onOpenChange(false);
  }

  return (
    <ConfirmSheet
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      title={REVOKE_COPY.title(license.code)}
      description={revokeBody(license, reason)}
      confirmLabel={
        reason === "payment_reversed"
          ? REVOKE_COPY.confirmNoRefund
          : REVOKE_COPY.confirm
      }
      confirmVariant="destructive"
      confirmLoading={pending}
      confirmLoadingLabel={REVOKE_COPY.pending}
      onConfirm={(event) => {
        event.preventDefault();
        void revoke();
      }}
      cancelLabel={REVOKE_COPY.cancel}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <ReasonNoteFields
        field={field}
        labels={LICENSE_REVOKED_REASON_LABELS}
        error={error}
      />
    </ConfirmSheet>
  );
}
