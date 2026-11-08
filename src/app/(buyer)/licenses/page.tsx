import type { Metadata } from "next";
import { BuyerLicenseRow } from "@/components/buyer/buyer-license-row";
import { MyLicensesTitle } from "@/components/buyer/my-licenses-title";
import { EmptyState } from "@/components/ui/empty-state";
import { sentences } from "@/lib/format";
import { LICENSE_RECORD_COPY } from "@/lib/licensing/license-record";
import { PRIVATE_PAGE } from "@/lib/private-page";
import { maskEmail } from "@/lib/sign-in";
import { myLicensesPath } from "@/lib/urls";
import { requireUser } from "@/server/auth/session";
import { listBuyerLicenses } from "@/server/buyers/queries";

const COPY = LICENSE_RECORD_COPY.myLicenses;

/**
 * "My licenses" (the root template adds " · ClipLease") and PRIVATE_PAGE (07 §9.2; a row's back link and onboarding's
 * link are client navigations).
 */
export const metadata: Metadata = { ...PRIVATE_PAGE, title: COPY.title };

/**
 * S30 `/licenses`, My licenses (05 §4.9; 04 §9.37, §11.11; 07 D126): every license whose request's buyer email is the
 * session's, newest first, in the (buyer) layout's one centered column. The two-tone title and "Signed in as {masked
 * email}", then one surface card of BuyerLicenseRows. With none, the empty state stands for the page: "My licenses.
 * None yet." and the masked email, neutral about other emails (05 §4.9 callout 7). A failed read is error.tsx's.
 * No loading.tsx (05's Loading state isn't built): a streamed route answers 200, and the sign-in redirect must be real.
 */
export default async function MyLicensesPage() {
  const user = await requireUser(myLicensesPath);
  const licenses = await listBuyerLicenses(user);
  const masked = maskEmail(user.email);
  if (licenses.length === 0) {
    return (
      <EmptyState
        as="h1"
        title={
          <>
            {COPY.empty.lead}{" "}
            <span className="text-ink-2">{COPY.empty.rest}</span>
          </>
        }
        description={sentences(COPY.emptyBody(masked), COPY.otherEmail)}
        className="wrap-anywhere"
      />
    );
  }
  return (
    <>
      <div className="flex flex-col gap-2">
        <MyLicensesTitle />
        <p className="text-footnote text-ink-2 wrap-anywhere">
          {COPY.signedInAs(masked)}
        </p>
      </div>
      <ul className="flex flex-col rounded-lg border border-hairline bg-surface">
        {licenses.map((license) => (
          <BuyerLicenseRow key={license.licenseId} license={license} />
        ))}
      </ul>
    </>
  );
}
