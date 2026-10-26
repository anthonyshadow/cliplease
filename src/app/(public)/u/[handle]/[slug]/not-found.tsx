import { HomeLink, NotFoundBody } from "@/components/layout/not-found-body";
import { CreatorVideosLink } from "@/components/license/creator-videos-link";
import { LICENSE_PAGE_COPY } from "@/lib/licensing/license-page";

// A video link that isn't licensable (07 D03, D72; 01 J6.5; 05 §10), whatever the reason, and an unknown creator's
// too: "See @{handle}'s videos" when the address names a possible handle (owner answer Q-105 a), else the home link.
export default function LicenseNotFound() {
  return (
    <NotFoundBody title={LICENSE_PAGE_COPY.unavailable}>
      <CreatorVideosLink fallback={<HomeLink />} />
    </NotFoundBody>
  );
}
