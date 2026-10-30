"use server";

import { refresh } from "next/cache";
import { type ActionResult, fieldErrors } from "@/lib/result";
import {
  type RateCardInput,
  rateCardFieldErrors,
  rateCardInputSchema,
} from "@/lib/validation/pricing";
import { requireCreator, toActor } from "@/server/auth/session";
import {
  InvalidRateCardError,
  saveRateCard as saveCard,
} from "@/server/pricing/rate-card";
import { redactErrors } from "@/server/rethrow-redacted";

const refused = (fields: Record<string, string>) =>
  fieldErrors("invalid_input", Object.entries(fields));

/**
 * Save prices and Reset to defaults (02 §6.1, J4.6, J4.10). The creator first: the bounds are in their payout_currency.
 * Field errors come back per field (`basePriceCents`, an option's key, a group); the domain re-parses as the authority.
 */
export async function saveRateCard(
  input: RateCardInput,
): Promise<ActionResult> {
  return redactErrors("pricing.save_failed", async () => {
    const ctx = await requireCreator("/dashboard/pricing");
    const parsed = rateCardInputSchema(ctx.creator.payoutCurrency).safeParse(
      input,
    );
    if (!parsed.success) {
      return refused(rateCardFieldErrors(parsed.error, input));
    }
    try {
      await saveCard(toActor(ctx), parsed.data);
    } catch (error) {
      if (error instanceof InvalidRateCardError) return refused(error.fields);
      throw error;
    }
    refresh();
    return { ok: true, data: undefined };
  });
}
