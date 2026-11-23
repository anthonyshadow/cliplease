"use client";

import { Button } from "@/components/ui/button";
import { REVOKE_COPY } from "@/lib/admin/copy";
import type { MoneyMovementStatus } from "@/lib/domain/values";
import type { AdminLicenseRow } from "@/server/admin/queries";
import { RevokeLicenseSheet } from "./revoke-license-sheet";
import { useFocusHandOff } from "./use-focus-hand-off";
import { useSheetOpenings } from "./use-sheet-openings";

/** What a Licenses row's Revoke needs: the license, what its sheet says about the money, and its transfer's status. */
export type AdminLicenseAction = Pick<
  AdminLicenseRow,
  | "id"
  | "code"
  | "creatorHandle"
  | "licensePriceCents"
  | "amountTotalCents"
  | "currency"
> & { transferStatus: MoneyMovementStatus | null };

/**
 * A Licenses row's action (05 §7 callouts 5, 10): Revoke, a secondary sm button named "Revoke {code}" for screen
 * readers, opening its sheet; the table shows it only while the license isn't revoked. The sheet mounts at the first
 * opening, and each opening starts it afresh. The focus comes back to the button when the sheet closes; a revoke that
 * went through removes the button, and the focus goes to the row's code (useFocusHandOff). The table renders the row
 * twice (stacked and wide), so each copy has its own sheet.
 */
export function LicenseRowAction({ license }: { license: AdminLicenseAction }) {
  const { trigger, opening, onCloseAutoFocus } =
    useFocusHandOff<HTMLButtonElement>();
  const sheet = useSheetOpenings();
  return (
    <>
      <Button
        ref={trigger}
        variant="secondary"
        size="sm"
        aria-label={REVOKE_COPY.actionLabel(license.code)}
        onClick={() => {
          opening();
          sheet.show();
        }}
      >
        {REVOKE_COPY.action}
      </Button>
      {sheet.mounted ? (
        <RevokeLicenseSheet
          key={sheet.openings}
          license={license}
          open={sheet.open}
          onOpenChange={sheet.onOpenChange}
          onCloseAutoFocus={onCloseAutoFocus}
        />
      ) : null}
    </>
  );
}
