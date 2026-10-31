// `bun run email:dev` (02 §11.1): the template with the demo request (05 §4.1, 07 D99), declined by its creator. The
// link is a placeholder, never a real key. Preview only; nothing in the app imports it.
import { RequestDeclined } from "../request-declined";

export default function RequestDeclinedPreview() {
  return (
    <RequestDeclined
      handle="maya"
      title="First snow"
      scope="Paid social ads · 1 year · Worldwide"
      statusReason="creator"
      url="http://localhost:3000/r/00000000-0000-4000-8000-000000000201?t=preview"
    />
  );
}
