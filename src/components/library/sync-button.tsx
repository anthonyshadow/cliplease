"use client";

import { RefreshCw } from "lucide-react";
import { useId, useLayoutEffect, useRef } from "react";
import {
  syncAccount,
  syncAllAccounts,
} from "@/app/(dashboard)/dashboard/_actions/social";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { usePendingAction } from "@/components/ui/use-pending-action";
import type { ActionResult } from "@/lib/result";
import { type AccountSyncOutcome, ALREADY_SYNCING } from "./library-messages";
import { useLibrarySync } from "./library-sync";

type Target =
  | { socialAccountId: string; mode?: "recent" | "older"; all?: never }
  | { all: true; socialAccountId?: never; mode?: never };

/** Every account's outcome, from Sync all or from one account's sync. */
async function runSync(
  target: Target,
): Promise<ActionResult<AccountSyncOutcome[]>> {
  if (target.all) return syncAllAccounts();
  const { socialAccountId, mode } = target;
  const result = await syncAccount({ socialAccountId, mode });
  return result.ok
    ? { ok: true, data: [{ socialAccountId, result: result.data }] }
    : result;
}

/**
 * 04 §9.15: Sync now / Try again for one account, Sync all for every connected one (`all`), Load older videos (mode
 * 'older'). While it runs the button reads "Syncing…" with the standard spinner (owner answer Q-22) and a second tap only
 * says "Already syncing"; `blockedHelper` disables it with the line under it while the platform has us waiting. The
 * Server Action's refresh() re-renders the page; on the Library every sync also drives SyncStatus
 * (LibrarySyncProvider), and `onSettled` hears the outcomes. A failure says so in a toast; the page stays.
 */
export function SyncButton({
  label = "Sync now",
  variant = "secondary",
  icon = variant === "secondary",
  fullWidth = false,
  disabled = false,
  describedBy,
  blockedHelper = null,
  focusAfterRemove,
  onSettled,
  ...target
}: Target & {
  label?: "Sync now" | "Try again" | "Sync all" | "Load older videos";
  variant?: "primary" | "secondary" | "tertiary" | "link";
  /** The RefreshCw icon; on by default for the secondary button. */
  icon?: boolean;
  /** Full width below md (Load older videos, the expired Library's Sync now; 07 D149). */
  fullWidth?: boolean;
  disabled?: boolean;
  describedBy?: string;
  /** "Try again in {n} min.": the button is disabled and described by this line, shown under it (04 §9.15). */
  blockedHelper?: string | null;
  /** The id of the element that takes the focus when the sync this button ran removes it (a cleared banner). */
  focusAfterRemove?: string;
  onSettled?: (outcomes: AccountSyncOutcome[] | null) => void;
}) {
  const library = useLibrarySync();
  const [pending, run] = usePendingAction();
  const helperId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const fallback = useRef(focusAfterRemove);
  fallback.current = focusAfterRemove;
  // A layout-effect cleanup runs before React removes the button, so it still sees the focus on it (WCAG 2.4.3).
  useLayoutEffect(() => {
    const node = wrapper.current;
    return () => {
      const id = fallback.current;
      if (id && node?.contains(document.activeElement)) {
        document.getElementById(id)?.focus({ preventScroll: true });
      }
    };
  }, []);

  const sync = async () => {
    library?.start();
    const result = await run(() => runSync(target));
    const outcomes = result?.ok ? result.data : null;
    if (result && !result.ok) toast(result.error.message);
    else if (
      outcomes?.some(
        ({ result }) => !result.ok && result.reason === "already_syncing",
      )
    ) {
      toast(ALREADY_SYNCING);
    }
    library?.settle(outcomes, target.all === true);
    onSettled?.(outcomes);
  };

  const width = fullWidth ? "w-full md:w-auto" : undefined;
  return (
    <>
      {/* A tap while busy only says "Already syncing" (the Button swallows it, so the wrapper hears it first). A plain
          button, not a form: a tap before hydration does nothing. */}
      <div
        ref={wrapper}
        className={width}
        onClickCapture={() => {
          if (pending) toast(ALREADY_SYNCING);
        }}
      >
        <Button
          variant={variant}
          size={variant === "primary" ? "lg" : "sm"}
          loading={pending}
          loadingLabel="Syncing…"
          disabled={disabled || blockedHelper !== null}
          aria-describedby={blockedHelper ? helperId : describedBy}
          className={width}
          onClick={() => void sync()}
        >
          {icon ? <RefreshCw aria-hidden size={16} /> : null}
          {label}
        </Button>
      </div>
      {blockedHelper ? (
        <p id={helperId} className="text-footnote text-ink-2">
          {blockedHelper}
        </p>
      ) : null}
    </>
  );
}
