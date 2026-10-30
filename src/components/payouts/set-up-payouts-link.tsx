import Link from "next/link";
import { Button } from "@/components/ui/button";
import { INBOX_COPY } from "@/lib/licensing/inbox";
import { PAYOUTS_SETTINGS_PATH } from "@/lib/urls";

/** "Set up payouts" to Settings' payouts section (owner answer Q5): the Inbox's Banner, the request page, a row's line. */
export function SetUpPayoutsLink({ size }: { size?: "sm" }) {
  return (
    <Button asChild variant="link" size={size}>
      <Link href={PAYOUTS_SETTINGS_PATH}>{INBOX_COPY.setUpPayouts}</Link>
    </Button>
  );
}
