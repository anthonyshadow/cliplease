import Link from "next/link";
import { APP_NAME } from "@/lib/app-name";

// 04 §4.5: APP_NAME as live text, no logomark. h-11 keeps the 44 px touch target.
export function Wordmark({
  href = "/",
  prefetch,
}: {
  /** `/` for public pages and buyers, `/dashboard` for creators (04 §9.30). */
  href?: string;
  prefetch?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className="inline-flex h-11 items-center text-body font-semibold text-ink"
    >
      {APP_NAME}
    </Link>
  );
}
