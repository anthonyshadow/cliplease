import { MessageBody } from "@/components/layout/public-shell";
import { REQUEST_STATUS_COPY } from "@/lib/licensing/request-status";

// A buyer link that opens nothing (05 §10 S27): a wrong or old key, an unknown id. No hint that a request exists, and no
// action (05 §10's "Buyer link dead").
export default function RequestNotFound() {
  return <MessageBody title={REQUEST_STATUS_COPY.deadLink} />;
}
