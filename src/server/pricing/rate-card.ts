import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { creatorProfile, rateCard, rateOption } from "@/db/schema";
import {
  type Currency,
  isOneOf,
  RATE_OPTION_KEYS,
  type RateDimension,
  type RateOptionKey,
  USE_KEYS,
  type UseKey,
} from "@/lib/domain/values";
import {
  type RateChoice,
  type RateChoices,
  rateChoices,
} from "@/lib/pricing/choices";
import { fromPriceCents } from "@/lib/pricing/from-price";
import {
  type RateCardInput,
  rateCardFieldErrors,
  rateCardInputSchema,
} from "@/lib/validation/pricing";
import { type Actor, requireCreatorActor } from "@/server/auth/actor";
import { env } from "@/server/env";

// The creator's rate card (02 §5.5, 03 §3.4; J4): one base price in the creator's payout_currency (rate_card has no
// currency column, 07 D94) and the 10 options of 03 §8.1. P19e adds the exclusive fields (07 D109).

export type RateCardOption = {
  dimension: RateDimension;
  key: RateOptionKey;
  enabled: boolean;
  multiplierBps: number;
  sortOrder: number;
};

export type RateCardDTO = {
  /** The creator's payout_currency (07 D94, D97). */
  currency: Currency;
  basePriceCents: number;
  /** Use, then Term, then Territory, each in its sort order. */
  options: RateCardOption[];
};

/** A card the server's own parse refuses: crafted input the editor never sends (01 J4.9). Nothing is saved. */
export class InvalidRateCardError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super("The rate card isn't valid");
    this.name = "InvalidRateCardError";
  }
}

/**
 * The creator's card, read with their payout_currency (`exec`: db, or the transaction reading it). Onboarding creates
 * it, so a missing card is a bug.
 */
export async function getRateCard(
  creatorId: string,
  exec: Pick<typeof db, "select"> = db,
): Promise<RateCardDTO> {
  const rows = await exec
    .select({
      currency: creatorProfile.payoutCurrency,
      basePriceCents: rateCard.basePriceCents,
      dimension: rateOption.dimension,
      key: rateOption.optionKey,
      enabled: rateOption.enabled,
      multiplierBps: rateOption.multiplierBps,
      sortOrder: rateOption.sortOrder,
    })
    .from(rateCard)
    .innerJoin(creatorProfile, eq(creatorProfile.id, rateCard.creatorId))
    .innerJoin(rateOption, eq(rateOption.rateCardId, rateCard.id))
    .where(eq(rateCard.creatorId, creatorId))
    // The rate_dimension enum sorts in RATE_DIMENSIONS order: use, term, territory.
    .orderBy(asc(rateOption.dimension), asc(rateOption.sortOrder));
  const [first] = rows;
  if (!first) throw new Error(`Creator ${creatorId} has no rate card`);
  return {
    currency: first.currency,
    basePriceCents: first.basePriceCents,
    options: rows.map(
      ({ currency: _c, basePriceCents: _b, ...option }) => option,
    ),
  };
}

/**
 * Replaces the actor's card in one transaction: the base, then each option's switch and multiplier by
 * (rate_card_id, option_key). A full replace, so a retry is idempotent. Re-parsed here with the payout_currency read in
 * the transaction, the authority over the action's own parse. New requests only: a request keeps its snapshot (J4.7).
 */
export async function saveRateCard(
  a: Actor,
  input: RateCardInput,
): Promise<void> {
  const actor = requireCreatorActor(a);
  await db.transaction(async (tx) => {
    const [card] = await tx
      .select({ id: rateCard.id, currency: creatorProfile.payoutCurrency })
      .from(rateCard)
      .innerJoin(creatorProfile, eq(creatorProfile.id, rateCard.creatorId))
      .where(eq(rateCard.creatorId, actor.creatorId))
      .for("update", { of: rateCard });
    if (!card) throw new Error(`Creator ${actor.creatorId} has no rate card`);
    const parsed = rateCardInputSchema(card.currency).safeParse(input);
    if (!parsed.success) {
      throw new InvalidRateCardError(rateCardFieldErrors(parsed.error, input));
    }
    await tx
      .update(rateCard)
      .set({ basePriceCents: parsed.data.basePriceCents })
      .where(eq(rateCard.id, card.id));
    let updated = 0;
    for (const option of parsed.data.options) {
      const rows = await tx
        .update(rateOption)
        .set({ enabled: option.enabled, multiplierBps: option.multiplierBps })
        .where(
          and(
            eq(rateOption.rateCardId, card.id),
            eq(rateOption.optionKey, option.key),
          ),
        )
        .returning({ id: rateOption.id });
      updated += rows.length;
    }
    if (updated !== RATE_OPTION_KEYS.length) {
      throw new Error(`Rate card ${card.id} doesn't have its 10 options`);
    }
  });
}

/** What a video changes about its creator's card (07 D82); the pricing page passes no changes. */
export type VideoPricing = {
  disabledUses: readonly UseKey[];
  basePriceOverrideCents: number | null;
};

/** A video row's VideoPricing: its disabled uses (only use keys count) and its base override (07 D82). */
export const videoPricingOf = (row: {
  disabledUses: readonly RateOptionKey[];
  basePriceOverrideCents: number | null;
}): VideoPricing => ({
  disabledUses: row.disabledUses.filter((key) => isOneOf(USE_KEYS, key)),
  basePriceOverrideCents: row.basePriceOverrideCents,
});

export type EffectiveOptions = Omit<RateChoices, "use"> & {
  currency: Currency;
  basePriceCents: number;
  basePriceSource: "rate_card" | "video";
  use: Array<RateChoice<UseKey> & { disabledReason?: "music" | "creator" }>;
};

/**
 * The options a buyer can pick for one video (02 §5.5, 07 D82): the video's base override, else the card's; a use is on
 * when it is on in the card and not in `disabledUses` (only the music rule puts paid_social and broadcast there, P13).
 * A use off in the card says 'creator', which wins over 'music'. Term and territory follow the card alone.
 */
export function effectiveOptions(
  rateCard: RateCardDTO,
  video: VideoPricing,
): EffectiveOptions {
  const { use, term, territory } = rateChoices(rateCard.options);
  const override = video.basePriceOverrideCents;
  return {
    currency: rateCard.currency,
    basePriceCents: override ?? rateCard.basePriceCents,
    basePriceSource: override === null ? "rate_card" : "video",
    use: use.map((choice) => {
      if (!choice.enabled) return { ...choice, disabledReason: "creator" };
      if (video.disabledUses.includes(choice.key)) {
        return { ...choice, enabled: false, disabledReason: "music" };
      }
      return choice;
    }),
    term,
    territory,
  };
}

/**
 * A video's "From {price}" on its cards (04 §9.27; 07 D82, D98): fromPriceCents over its effective options with the
 * server's fee, and the currency to print it in.
 */
export function videoFromPrice(
  rateCard: RateCardDTO,
  video: Parameters<typeof videoPricingOf>[0],
): { fromPriceCents: number | null; currency: Currency } {
  return {
    fromPriceCents: fromPriceCents(
      effectiveOptions(rateCard, videoPricingOf(video)),
      env.PLATFORM_FEE_BPS,
    ),
    currency: rateCard.currency,
  };
}
