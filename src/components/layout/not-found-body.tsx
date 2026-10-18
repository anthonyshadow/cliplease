import Link from "next/link";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/app-name";
import { MessageBody } from "./public-shell";

/** The 404 copy (05 §10, owner answer 3a), shared by the not-found files; `title` names what is missing. */
export function NotFoundBody({
  title = "Page not found.",
}: {
  title?: string;
}) {
  return (
    <MessageBody title={title}>
      <Button asChild variant="link">
        <Link href="/">{`Go to ${APP_NAME}`}</Link>
      </Button>
    </MessageBody>
  );
}
