"use client";

import { MyLicensesTitle } from "@/components/buyer/my-licenses-title";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { MY_LICENSES_COPY as COPY } from "@/lib/licensing/my-licenses-copy";

/**
 * S30's page error (05 §4.9 States: a failed query), in the (buyer) layout's column: the title, then the error Banner
 * with Try again. `retry()` re-fetches and re-renders the segment (Next ≥ 16.3; P02's decision). The copy comes from
 * its leaf module, so this client file carries nothing else. /licenses/[licenseId] has its own error.tsx (05 §10's
 * words).
 */
export default function MyLicensesError({ retry }: { retry: () => void }) {
  return (
    <>
      <MyLicensesTitle />
      <Banner
        tone="error"
        action={
          <Button variant="link" size="sm" onClick={() => retry()}>
            {COPY.tryAgain}
          </Button>
        }
      >
        {COPY.loadFailed}
      </Banner>
    </>
  );
}
