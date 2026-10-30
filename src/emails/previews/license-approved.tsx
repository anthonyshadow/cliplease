// `bun run email:dev` (02 §11.1): the template with the demo request's license (05 §4.1, 07 D99). The links are
// placeholders, never a real key. Preview only; nothing in the app imports it.
import { LicenseApproved } from "../license-approved";

export default function LicenseApprovedPreview() {
  return (
    <LicenseApproved
      handle="maya"
      title="First snow"
      scope="Paid social ads · 1 year · Worldwide"
      code="CL-7K3M-9QXA"
      amountTotalCents={173250}
      currency="cad"
      url="http://localhost:3000/l/preview"
      verifyUrl="http://localhost:3000/verify/CL-7K3M-9QXA"
    />
  );
}
