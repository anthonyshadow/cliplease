// The stored form of an email address (07 D126): trimmed and lowercased, nothing else; dots and "+tags" are kept. Pure.
// license_request.buyer_email holds it, and from P20b My licenses matches a signed-in buyer's licenses by it.

/** "  Ana.Buyer+ads@Studio.COM " → "ana.buyer+ads@studio.com". */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
