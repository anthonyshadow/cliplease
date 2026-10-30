// A license's only status (research/license.md §6.2; 07 D16): computed, never stored. Pure.

export type PublicLicenseStatus = "valid" | "expired" | "revoked" | "not_found";

/** Revoked wins over expired; a license is expired from the instant it ends; no license is not_found. */
export function publicStatus(
  l: { revokedAt: Date | null; endsAt: Date | null } | null,
  now: Date,
): PublicLicenseStatus {
  if (!l) return "not_found";
  if (l.revokedAt && l.revokedAt <= now) return "revoked";
  if (l.endsAt && now >= l.endsAt) return "expired";
  return "valid";
}
