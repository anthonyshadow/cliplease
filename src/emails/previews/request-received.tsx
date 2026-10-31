// `bun run email:dev` (02 §11.1): the template with the demo request (05 §4.1, 07 D99). The link is a placeholder,
// never a real key. Preview only; nothing in the app imports it.
import { RequestReceived } from "../request-received";

export default function RequestReceivedPreview() {
  return (
    <RequestReceived
      handle="maya"
      title="First snow"
      scope="Paid social ads · 1 year · Worldwide"
      amountTotalCents={173250}
      currency="cad"
      expiresAt={new Date("2026-11-01T17:00:00Z")}
      timeZone="America/Toronto"
      autoApprove={false}
      url="http://localhost:3000/r/00000000-0000-4000-8000-000000000201?t=preview"
    />
  );
}
