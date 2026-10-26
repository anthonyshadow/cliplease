import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/app-name";
import { MessageBody } from "./public-shell";

/** "Go to {APP_NAME}": the 404's way out (05 §10). */
export function HomeLink() {
  return (
    <Button asChild variant="link">
      <Link href="/">{`Go to ${APP_NAME}`}</Link>
    </Button>
  );
}

/**
 * The 404 copy (05 §10, owner answer 3a), shared by the not-found files; `title` names what is missing, and `children`
 * replace the home link where 05 §10 gives the view its own (the license page's "See @{handle}'s videos").
 */
export function NotFoundBody({
  title = "Page not found.",
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return <MessageBody title={title}>{children ?? <HomeLink />}</MessageBody>;
}
