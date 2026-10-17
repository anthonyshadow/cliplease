import Link from "next/link";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/app-name";
import { MessageBody } from "./public-shell";

/** The 404 copy (05 §10, owner answer 3a), shared by the root and the (public) not-found files. */
export function NotFoundBody() {
  return (
    <MessageBody title="Page not found.">
      <Button asChild variant="link">
        <Link href="/">{`Go to ${APP_NAME}`}</Link>
      </Button>
    </MessageBody>
  );
}
