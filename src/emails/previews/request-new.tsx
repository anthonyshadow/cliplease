// `bun run email:dev` (02 §11.1): the template with the demo request (05 §4.1, 07 D99), payouts not set up yet so the
// payouts line shows. Preview only; nothing in the app imports it.
import { RequestNew } from "../request-new";

export default function RequestNewPreview() {
  return (
    <RequestNew
      licenseeName="Daily Laughs Media LLC"
      title="First snow"
      scope="Paid social ads · 1 year · Worldwide"
      licensePriceCents={157500}
      currency="cad"
      expiresAt={new Date("2026-11-01T17:00:00Z")}
      timeZone="America/Toronto"
      payoutsActive={false}
      url="http://localhost:3000/dashboard/requests/00000000-0000-4000-8000-000000000201"
    />
  );
}
