"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionResult, GENERIC_ERROR_MESSAGE } from "@/lib/result";
import { requireCreator, toActor } from "@/server/auth/session";
import { disconnectSocialAccount } from "@/server/social/disconnect";
import {
  type AccountSyncResult,
  type SyncResult,
  syncCreatorAccounts,
  syncSocialAccount,
} from "@/server/social/sync";
import type { RevokeOutcome } from "@/server/social/types";

// The on-demand sync triggers (02 §6.1, 07 D13). A sync's own failures come back in SyncResult, never as a throw.

const syncInput = z.object({
  socialAccountId: z.uuid(),
  mode: z.enum(["recent", "older"]).default("recent"),
});

/** Sync now on one account; P09's Load older videos sends mode 'older'. */
export async function syncAccount(
  input: z.input<typeof syncInput>,
): Promise<ActionResult<SyncResult>> {
  const parsed = syncInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "invalid_input", message: GENERIC_ERROR_MESSAGE },
    };
  }
  const ctx = await requireCreator("/dashboard/connections");
  const { socialAccountId, mode } = parsed.data;
  const result = await syncSocialAccount(socialAccountId, toActor(ctx), {
    mode,
  });
  refresh();
  return { ok: true, data: result };
}

/** Sync all (P09's Library header): every connected account, one after another, within 25 s. */
export async function syncAllAccounts(): Promise<
  ActionResult<AccountSyncResult[]>
> {
  const ctx = await requireCreator("/dashboard/library");
  const data = await syncCreatorAccounts(toActor(ctx));
  refresh();
  return { ok: true, data };
}

const disconnectInput = z.object({ socialAccountId: z.uuid() });

/** Disconnect… → Disconnect (05 §6.2): the card becomes its ConnectRow again on the re-render. */
export async function disconnectAccount(
  input: z.input<typeof disconnectInput>,
): Promise<ActionResult<{ revoked: RevokeOutcome }>> {
  const parsed = disconnectInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "invalid_input", message: GENERIC_ERROR_MESSAGE },
    };
  }
  const ctx = await requireCreator("/dashboard/connections");
  const result = await disconnectSocialAccount(
    parsed.data.socialAccountId,
    toActor(ctx),
  );
  if (!result) {
    return {
      ok: false,
      error: { code: "not_found", message: GENERIC_ERROR_MESSAGE },
    };
  }
  refresh();
  return { ok: true, data: result };
}
