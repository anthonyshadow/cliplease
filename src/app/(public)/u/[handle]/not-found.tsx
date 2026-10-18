import Link from "next/link";
import { MessageBody } from "@/components/layout/public-shell";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/app-name";

// An unknown /@handle (05 §10), inside the public NavBar and <main>.
export default function CreatorNotFound() {
  return (
    <MessageBody title="No creator here.">
      <Button asChild variant="link">
        <Link href="/">{`Go to ${APP_NAME}`}</Link>
      </Button>
    </MessageBody>
  );
}
