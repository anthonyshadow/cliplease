import "server-only";
import type { LicenseRequest } from "@/db/schema/types";
import type { Authorization } from "../payments/driver";
import { transferGroupFor } from "../payments/keys";

// The D32 asserts on a held PaymentIntent (07 D32, as amended by D74 and D95): a platform charge for the request's own
// total in its own currency, captured by hand, with no Connect routing (separate charges and transfers). Payouts are
// not checked: a buyer can pay before the creator sets them up (07 D74).

/** What `auth` and its session's currency get wrong about request `row`, by field name; empty when it may be held. */
export function authorizationMismatches(
  row: Pick<LicenseRequest, "id" | "amountTotalCents" | "currency">,
  auth: Authorization,
  sessionCurrency: string | null,
): string[] {
  const checks: [field: string, ok: boolean][] = [
    ["amountCents", auth.amountCents === row.amountTotalCents],
    ["currency", auth.currency === row.currency],
    ["sessionCurrency", sessionCurrency === row.currency],
    ["captureMethod", auth.captureMethod === "manual"],
    ["metadataRequestId", auth.metadataRequestId === row.id],
    ["applicationFeeCents", auth.applicationFeeCents === null],
    ["destination", auth.destination === null],
    ["onBehalfOf", auth.onBehalfOf === null],
    ["transferGroup", auth.transferGroup === transferGroupFor(row.id)],
  ];
  return checks.filter(([, ok]) => !ok).map(([field]) => field);
}
