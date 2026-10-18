"use client";

import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";

/**
 * Back from payout setup with payouts on: one toast (05 §6.11 States, proposed copy). The address keeps
 * ?payouts=returned: rewriting it on the client starts a router update in Next 16, and a Settings action sent during it
 * is cancelled.
 */
export function PayoutsReturnedToast() {
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    toast("Payouts are on.");
  }, []);
  return null;
}
