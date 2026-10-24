// A card's options as the three groups a buyer picks from (02 §5.5's EffectiveOptions groups, the PricePreview's
// pickers), and RateRow's example price (04 §9.29). Pure, for the server's effectiveOptions and the browser's editor.
import {
  RATE_DIMENSIONS,
  type RateDimension,
  type RateOptionKey,
  TERM_KEYS,
  TERRITORY_KEYS,
  type TermKey,
  type TerritoryKey,
  USE_KEYS,
  type UseKey,
} from "../domain/values";
import { rateOptionLabel } from "../licensing/options";
import { licensePriceCents } from "./compute-quote";

/** One option as a buyer picks it. */
export type RateChoice<K extends RateOptionKey = RateOptionKey> = {
  key: K;
  label: string;
  bps: number;
  enabled: boolean;
};

export type RateChoices = {
  use: RateChoice<UseKey>[];
  term: RateChoice<TermKey>[];
  territory: RateChoice<TerritoryKey>[];
};

type RateOptionValue = {
  key: RateOptionKey;
  multiplierBps: number;
  enabled: boolean;
};

const isOneOf = <K extends RateOptionKey>(
  keys: readonly K[],
  key: RateOptionKey,
): key is K => (keys as readonly RateOptionKey[]).includes(key);

/** The options (stored, or being edited) in their groups, in the card's order, with their buyer labels. */
export function rateChoices(options: readonly RateOptionValue[]): RateChoices {
  const of = <K extends RateOptionKey>(keys: readonly K[]) =>
    options.flatMap(({ key, multiplierBps, enabled }) =>
      isOneOf(keys, key)
        ? [{ key, label: rateOptionLabel(key), bps: multiplierBps, enabled }]
        : [],
    );
  return {
    use: of(USE_KEYS),
    term: of(TERM_KEYS),
    territory: of(TERRITORY_KEYS),
  };
}

/** Base × this option × the first option on in each other group (04 §9.29); null when another group has none on. */
export function examplePriceCents(
  basePriceCents: number,
  choices: RateChoices,
  dimension: RateDimension,
  bps: number,
): number | null {
  const [use, term, territory] = RATE_DIMENSIONS.map((d) =>
    d === dimension ? bps : choices[d].find((c) => c.enabled)?.bps,
  );
  if (use === undefined || term === undefined || territory === undefined) {
    return null;
  }
  return licensePriceCents(basePriceCents, use, term, territory);
}
