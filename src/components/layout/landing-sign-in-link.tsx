"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Only the landing page shows "Sign in" in the header (05 §4.7). Ink tertiary style: no link-blue
// text in a frosted bar (04 §2.2, §2.4). No prefetch: /sign-in doesn't exist until P04.
export function LandingSignInLink() {
  const pathname = usePathname();
  if (pathname !== "/") return null;
  return (
    <Link
      href="/sign-in"
      prefetch={false}
      className="inline-flex h-11 items-center text-body font-semibold text-ink underline-offset-4 hover:underline active:opacity-70"
    >
      Sign in
    </Link>
  );
}
