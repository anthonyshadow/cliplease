"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/result";
import { requireCreator, toActor } from "@/server/auth/session";
import {
  type AccountSyncResult,
  type SyncResult,
  syncCreatorAccounts,
  syncSocialAccount,
} from "@/server/social/sync";

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
      error: {
        code: "invalid_input",
        message: "Something went wrong. Try again.",
      },
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
