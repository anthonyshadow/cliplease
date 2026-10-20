import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** "‹ Videos", "‹ Back" (04 §9.28): a tertiary link on the column's left edge. */
export function BackLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Button asChild variant="tertiary" className="min-w-0 self-start px-0">
      <Link href={href}>
        <ChevronLeft aria-hidden size={16} strokeWidth={2} />
        {children}
      </Link>
    </Button>
  );
}
