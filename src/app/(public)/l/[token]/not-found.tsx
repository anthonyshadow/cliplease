import { MessageBody } from "@/components/layout/public-shell";
import { REQUEST_STATUS_COPY } from "@/lib/licensing/request-status";

// A buyer link that opens no license (05 §10 S27, as /r's): a wrong or old key, a request that isn't approved. No hint
// that a license exists, and no action. Without this file notFound() would fall through to (public)'s generic 404.
export default function LicenseNotFound() {
  return <MessageBody title={REQUEST_STATUS_COPY.deadLink} />;
}
