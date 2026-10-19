"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { syncAccount } from "../_actions/social";

/**
 * Sync now for one account (04 §9.18 row 3; P08's SyncButton replaces it). The action re-renders the page with the new
 * status line, so the result needs no handling here.
 */
export function SyncNowForm({
  socialAccountId,
  describedBy,
}: {
  socialAccountId: string;
  /** The id of the account line the button syncs. */
  describedBy: string;
}) {
  const [, action, pending] = useActionState(async () => {
    await syncAccount({ socialAccountId });
  }, undefined);
  return (
    <form action={action}>
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        loading={pending}
        loadingLabel="Syncing…"
        aria-describedby={describedBy}
      >
        Sync now
      </Button>
    </form>
  );
}
