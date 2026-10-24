// The rate card's bounds (07 D21, D97), shared by the pricing editor and saveRateCard. Messages: 01 J4.2 and J4.3, the
// rest proposed copy (owner answers Q-91, Q-93). Each field shows its first issue, so the checks run bound first.
import { z } from "zod";
import {
  type Currency,
  RATE_DIMENSION_KEYS,
  RATE_DIMENSIONS,
  RATE_OPTION_KEYS,
  type RateDimension,
  type RateOptionKey,
} from "../domain/values";
import { formatMoney } from "../format";
import { multiplierFieldValue } from "../pricing/multiplier";
import {
  BASE_PRICE_MAX_CENTS,
  BASE_PRICE_MIN_CENTS,
  DEFAULT_BASE_PRICE_CENTS,
  defaultRateOptions,
  MULTIPLIER_MAX_BPS,
  MULTIPLIER_MIN_BPS,
  MULTIPLIER_STEP_BPS,
} from "../pricing/presets";
import { GENERIC_ERROR_MESSAGE } from "../result";

const WHOLE_DOLLARS_MESSAGE = "Use whole dollars.";

const MULTIPLIER_MESSAGES = {
  min: `Minimum is ×${multiplierFieldValue(MULTIPLIER_MIN_BPS)}.`,
  max: `Maximum is ×${multiplierFieldValue(MULTIPLIER_MAX_BPS)}.`,
  step: `Use steps of ${multiplierFieldValue(MULTIPLIER_STEP_BPS)}.`,
} as const;

const KEEP_ONE_MESSAGE = {
  use: "Keep at least one use.",
  term: "Keep at least one term.",
  territory: "Keep at least one territory.",
} as const satisfies Record<RateDimension, string>;

/** An issue that leaves each option's dimension, key and switch readable: anywhere but those three. */
function leavesOptionsReadable(issue: { path?: PropertyKey[] }) {
  const [first, , field] = issue.path ?? [];
  return (
    first !== undefined && (first !== "options" || field === "multiplierBps")
  );
}

/** Whole dollars from BASE_PRICE_MIN_CENTS to BASE_PRICE_MAX_CENTS, in minor units ("Minimum is CA$10."). */
export function basePriceCentsSchema(currency: Currency) {
  const whole = (cents: number) =>
    formatMoney(cents, currency, { wholeDollars: true });
  return z
    .number({ error: WHOLE_DOLLARS_MESSAGE })
    .int({ error: WHOLE_DOLLARS_MESSAGE })
    .min(BASE_PRICE_MIN_CENTS[currency], {
      error: `Minimum is ${whole(BASE_PRICE_MIN_CENTS[currency])}.`,
    })
    .max(BASE_PRICE_MAX_CENTS[currency], {
      error: `Maximum is ${whole(BASE_PRICE_MAX_CENTS[currency])}.`,
    })
    .multipleOf(100, { error: WHOLE_DOLLARS_MESSAGE });
}

/** ×1.00 to ×10.00 in steps of 0.05, as basis points. */
export const MultiplierBpsSchema = z
  .number({ error: MULTIPLIER_MESSAGES.step })
  .int({ error: MULTIPLIER_MESSAGES.step })
  .min(MULTIPLIER_MIN_BPS, { error: MULTIPLIER_MESSAGES.min })
  .max(MULTIPLIER_MAX_BPS, { error: MULTIPLIER_MESSAGES.max })
  .multipleOf(MULTIPLIER_STEP_BPS, { error: MULTIPLIER_MESSAGES.step });

const rateOptionInputSchema = z.object({
  dimension: z.enum(RATE_DIMENSIONS),
  key: z.enum(RATE_OPTION_KEYS),
  enabled: z.boolean(),
  multiplierBps: MultiplierBpsSchema,
});

/** The whole card: the base, then each of the 10 options exactly once, in its own group, and one on per group. */
export function rateCardInputSchema(currency: Currency) {
  return z
    .object({
      basePriceCents: basePriceCentsSchema(currency),
      options: z.array(rateOptionInputSchema),
    })
    .superRefine(
      (card, ctx) => {
        const keys = new Set(card.options.map((o) => o.key));
        const complete =
          card.options.length === RATE_OPTION_KEYS.length &&
          keys.size === RATE_OPTION_KEYS.length;
        const grouped = card.options.every((o) =>
          (
            RATE_DIMENSION_KEYS[o.dimension] as readonly RateOptionKey[]
          ).includes(o.key),
        );
        if (!complete || !grouped) {
          ctx.addIssue({
            code: "custom",
            path: ["options"],
            message: GENERIC_ERROR_MESSAGE,
          });
          return;
        }
        for (const dimension of RATE_DIMENSIONS) {
          if (
            !card.options.some((o) => o.dimension === dimension && o.enabled)
          ) {
            ctx.addIssue({
              code: "custom",
              path: [dimension],
              message: KEEP_ONE_MESSAGE[dimension],
            });
          }
        }
      },
      // Also when a base or a multiplier didn't read as a number: Save names a group with nothing on in the same pass.
      { when: (payload) => payload.issues.every(leavesOptionsReadable) },
    );
}

export type RateCardInput = z.infer<ReturnType<typeof rateCardInputSchema>>;

/** The J4.1 card in `currency`, as the editor sends it: what Reset to defaults saves. */
export function defaultRateCardInput(currency: Currency): RateCardInput {
  return {
    basePriceCents: DEFAULT_BASE_PRICE_CENTS[currency],
    options: defaultRateOptions().map((o) => ({
      dimension: o.dimension,
      key: o.optionKey,
      enabled: o.enabled,
      multiplierBps: o.multiplierBps,
    })),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** The key of `input.options[index]` when the (untrusted) input has one. */
function optionKeyAt(input: unknown, index: PropertyKey | undefined) {
  if (!isRecord(input) || !Array.isArray(input.options)) return undefined;
  const option: unknown =
    typeof index === "number" ? input.options[index] : undefined;
  return isRecord(option) && typeof option.key === "string"
    ? option.key
    : undefined;
}

/**
 * The first message of each field `input` failed on: `basePriceCents`, an option's key for its multiplier, a group
 * ("use" · "term" · "territory") for "Keep at least one …", or "options" for a card that isn't the 10 options.
 */
export function rateCardFieldErrors(
  error: z.ZodError,
  input: unknown,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const [first, index] = issue.path;
    const key = first === "options" ? optionKeyAt(input, index) : undefined;
    fields[key ?? String(first ?? "options")] ??= issue.message;
  }
  return fields;
}
