"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

// Only the landing page shows "Sign in" in the header (05 §4.7). A tertiary Button with no padding: no link-blue
// text in a frosted bar (04 §2.2, §2.4). No prefetch: /sign-in doesn't exist until P04.
export function LandingSignInLink() {
  const pathname = usePathname();
  if (pathname !== "/") return null;
  return (
    <Button asChild variant="tertiary" className="min-w-0 px-0">
      <Link href="/sign-in" prefetch={false}>
        Sign in
      </Link>
    </Button>
  );
}
