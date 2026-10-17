"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { CREATOR_NAV, MORE_SHEET_KEYS, SHELL_PREFETCH } from "./creator-nav";

// Plain rows, no separators (05 §1.3 draws none).
const ROW = "flex h-13 w-full items-center text-body text-ink";

/**
 * 04 §9.30 / 05 §1.3: a Sheet titled "More" with 52 px text rows, words only (no icons, no chevrons;
 * 04 §8.1 "No icons in menus, the More sheet"). Sign out is a slot P04 wires.
 */
export function MoreSheet({
  trigger,
  signOut,
}: {
  /** The TabBar's More tab. */
  trigger: ReactNode;
  signOut?: ReactNode;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent title="More">
        <nav>
          <ul className="flex flex-col">
            {MORE_SHEET_KEYS.map((key) => (
              <li key={key}>
                <SheetClose asChild>
                  <Link
                    href={CREATOR_NAV[key].href}
                    prefetch={SHELL_PREFETCH}
                    className={ROW}
                  >
                    {CREATOR_NAV[key].label}
                  </Link>
                </SheetClose>
              </li>
            ))}
            {signOut ? <li className={ROW}>{signOut}</li> : null}
          </ul>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
