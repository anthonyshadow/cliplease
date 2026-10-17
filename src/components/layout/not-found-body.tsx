import Link from "next/link";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/app-name";

/** The 404 copy (05 §10, owner answer 3a), shared by the root and the (public) not-found files. */
export function NotFoundBody() {
  return (
    <div className="mx-auto flex max-w-reading flex-col items-start gap-4 py-6 lg:py-12">
      <h1 className="text-title-1 text-ink">Page not found.</h1>
      <Button asChild variant="link">
        <Link href="/">{`Go to ${APP_NAME}`}</Link>
      </Button>
    </div>
  );
}
