"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { ApproveResult } from "@/lib/licensing/request-dto";
import { type ActionResult, formError } from "@/lib/result";
import { requireCreator, toActor } from "@/server/auth/session";
import { approveLicenseRequest } from "@/server/licensing/approve";
import { redactErrors } from "@/server/rethrow-redacted";

// The Inbox's and the request page's actions (02 §6.1, §8.2). Approve runs up to a Stripe call: the pages that host it
// export maxDuration = 60 (07 D26), since a "use server" file may export only async functions.

const requestInput = z.object({ requestId: z.uuid() });

/**
 * Approve, one tap (01 J8.2): the domain's result as data, whatever it is. refresh() updates the counts at once; the
 * Inbox keeps the acted row in place until its next refresh (02 §4.4 rule 2).
 */
export async function approveRequest(
  input: z.input<typeof requestInput>,
): Promise<ActionResult<ApproveResult>> {
  return redactErrors("license_request.approve_failed", async () => {
    const parsed = requestInput.safeParse(input);
    if (!parsed.success) return formError("invalid_input");
    const ctx = await requireCreator("/dashboard");
    const result = await approveLicenseRequest(
      parsed.data.requestId,
      toActor(ctx),
      { payoutsRow: ctx.creator },
    );
    refresh();
    return { ok: true, data: result };
  });
}
