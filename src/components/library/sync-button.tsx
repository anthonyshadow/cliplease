"use client";

import { RefreshCw } from "lucide-react";
import { useActionState } from "react";
import { syncAccount } from "@/app/(dashboard)/dashboard/_actions/social";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

const ALREADY_SYNCING = "Already syncing";

/**
 * 04 §9.15: Sync now for one account. While it runs the button reads "Syncing…" with the standard spinner (owner
 * answer Q-22) and a second tap only says "Already syncing"; `disabled` while the platform has us waiting (the card says
 * why, `describedBy`). The action re-renders the page with the new status.
 */
export function SyncButton({
  socialAccountId,
  label = "Sync now",
  disabled = false,
  describedBy,
}: {
  socialAccountId: string;
  label?: "Sync now" | "Try again";
  disabled?: boolean;
  describedBy?: string;
}) {
  const [, action, pending] = useActionState(async () => {
    const result = await syncAccount({ socialAccountId });
    if (
      result.ok &&
      !result.data.ok &&
      result.data.reason === "already_syncing"
    ) {
      toast(ALREADY_SYNCING);
    }
  }, undefined);
  return (
    // The Button swallows a tap while it is busy, so the form hears it first.
    <form
      action={action}
      onClickCapture={() => {
        if (pending) toast(ALREADY_SYNCING);
      }}
    >
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        loading={pending}
        loadingLabel="Syncing…"
        disabled={disabled}
        aria-describedby={describedBy}
      >
        <RefreshCw aria-hidden size={16} />
        {label}
      </Button>
    </form>
  );
}
