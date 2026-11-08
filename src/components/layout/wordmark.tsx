import Link from "next/link";
import { APP_NAME } from "@/lib/app-name";

// 04 §4.5: APP_NAME as live text, no logomark. h-11 keeps the 44 px touch target.
export function Wordmark({
  href = "/",
}: {
  /**
   * `/` for public and token pages, `/dashboard` for creators, `/licenses` on My licenses without a creator profile
   * (04 §9.30).
   */
  href?: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex h-11 items-center text-body font-semibold text-ink"
    >
      {APP_NAME}
    </Link>
  );
}
