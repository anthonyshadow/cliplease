"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { ApproveResult, DeclineResult } from "@/lib/licensing/request-dto";
import { type ActionResult, formError } from "@/lib/result";
import { requireCreator, toActor } from "@/server/auth/session";
import { approveLicenseRequest } from "@/server/licensing/approve";
import { declineLicenseRequest } from "@/server/licensing/requests";
import { redactErrors } from "@/server/rethrow-redacted";

// The Inbox's and the request page's actions (02 §6.1, §8.2). Approve and Decline each run up to a Stripe call: the
// pages that host them export maxDuration = 60 (07 D26), since a "use server" file may export only async functions.

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

/**
 * Decline, one tap (01 J8.4; owner answer OQ-31): the domain's result as data and refresh(), as Approve. The reason is
 * always the creator's (declineLicenseRequest's default), never the input's: a buyer is told video_disabled only when
 * an admin disables the video (07 D28).
 */
export async function declineRequest(
  input: z.input<typeof requestInput>,
): Promise<ActionResult<DeclineResult>> {
  return redactErrors("license_request.decline_failed", async () => {
    const parsed = requestInput.safeParse(input);
    if (!parsed.success) return formError("invalid_input");
    const ctx = await requireCreator("/dashboard");
    const result = await declineLicenseRequest(
      parsed.data.requestId,
      toActor(ctx),
    );
    refresh();
    return { ok: true, data: result };
  });
}
