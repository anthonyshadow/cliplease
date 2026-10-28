// The license page's choice (01 J7; 04 §9.3; 05 §4.1; P15): the buyer's selection, its quote, the tiles each group
// offers with their deltas, and the scope label the checkout, /r, the inbox and the emails print. Every price goes
// through quoteFor, so the bar, the deltas and the cap filter can't disagree. Pure, for the server and the browser.
import type { EffectiveOptions } from "../../server/pricing/rate-card";
import {
  isOneOf,
  type RateDimension,
  type RateOptionKey,
  REGION_KEYS,
  type TermKey,
  type TerritoryKey,
  type UseKey,
} from "../domain/values";
import { computeQuote, type QuoteResult } from "../pricing/compute-quote";
import { PLATFORM_FEE_MIN_CENTS } from "../pricing/presets";
import { countryInSentence, countryName } from "./countries";
import { REGIONS, rateOptionLabel } from "./options";

/** What the buyer has picked. `territoryCode`: an ISO code (country), a region key (region), else null. */
export type Selection = {
  use: UseKey;
  term: TermKey;
  territory: TerritoryKey;
  territoryCode: string | null;
};

type Keys = { use: UseKey; term: TermKey; territory: TerritoryKey };

/** The service fee's terms: the server's PLATFORM_FEE_BPS and the currency's floor (07 D79, D97). */
export type FeeTerms = { platformFeeBps: number; platformFeeMinCents: number };

export const feeTerms = (
  options: EffectiveOptions,
  feeBps: number,
): FeeTerms => ({
  platformFeeBps: feeBps,
  platformFeeMinCents: PLATFORM_FEE_MIN_CENTS[options.currency],
});

/** The option `key` of `group` when the buyer can pick it (on, and not music-disabled). */
function offered<G extends RateDimension>(
  options: EffectiveOptions,
  group: G,
  key: Keys[G],
) {
  return options[group].find((o) => o.key === key && o.enabled);
}

/** The multipliers `selection` is priced with (what a request snapshots), or null when one of its options isn't offered. */
export function chosenMultipliers(
  options: EffectiveOptions,
  selection: Selection,
): { useBps: number; termBps: number; territoryBps: number } | null {
  const use = offered(options, "use", selection.use);
  const term = offered(options, "term", selection.term);
  const territory = offered(options, "territory", selection.territory);
  return use && term && territory
    ? { useBps: use.bps, termBps: term.bps, territoryBps: territory.bps }
    : null;
}

/**
 * The quote for `selection` (computeQuote over the effective base, incl. a video's own base, 07 D82, D97), or null when
 * one of its options isn't offered. The territory code never changes the price: "One country" is priced before a
 * country is chosen.
 */
export function quoteFor(
  options: EffectiveOptions,
  selection: Selection,
  fees: FeeTerms,
): QuoteResult | null {
  const multipliers = chosenMultipliers(options, selection);
  if (!multipliers) return null;
  return computeQuote({
    currency: options.currency,
    basePriceCents: options.basePriceCents,
    ...multipliers,
    ...fees,
  });
}

/** The license price of `selection`, or null when it can't be bought (an option not offered, or over the cap). */
function licenseCents(
  options: EffectiveOptions,
  selection: Selection,
  feeBps: number,
): number | null {
  const quote = quoteFor(options, selection, feeTerms(options, feeBps));
  return quote?.ok ? quote.quote.licensePriceCents : null;
}

/** `selection` with `key` chosen in `group`; a new territory drops the code chosen for the old one. */
export function withOption<G extends RateDimension>(
  selection: Selection,
  group: G,
  key: Keys[G],
): Selection {
  const next = { ...selection, [group]: key };
  return group === "territory" && key !== selection.territory
    ? { ...next, territoryCode: null }
    : next;
}

/** A tile: the option, or a use the video's music turns off, shown disabled with its reason (01 J5.14). */
export type OfferedOption<K extends RateOptionKey> = {
  key: K;
  label: string;
  enabled: boolean;
  disabledReason?: "music";
};

export type OfferedOptions = {
  use: OfferedOption<UseKey>[];
  term: OfferedOption<TermKey>[];
  territory: OfferedOption<TerritoryKey>[];
};

/**
 * Each group's tiles for `selection` (04 §9.3; 07 D22, D82), in sort order: the options the creator offers, minus any
 * that would put the total over the cap with the other two current choices; a music-disabled use stays as a disabled
 * tile. Options the creator turned off are absent.
 */
export function offeredOptions(
  options: EffectiveOptions,
  selection: Selection,
  feeBps: number,
): OfferedOptions {
  const tiles = <G extends RateDimension>(group: G) =>
    options[group].flatMap((o): OfferedOption<Keys[G]>[] => {
      const key = o.key as Keys[G];
      if (!o.enabled) {
        return "disabledReason" in o && o.disabledReason === "music"
          ? [{ key, label: o.label, enabled: false, disabledReason: "music" }]
          : [];
      }
      const fits =
        licenseCents(options, withOption(selection, group, key), feeBps) !==
        null;
      return fits ? [{ key, label: o.label, enabled: true }] : [];
    });
  return {
    use: tiles("use"),
    term: tiles("term"),
    territory: tiles("territory"),
  };
}

/**
 * The first load's selection (01 J7.1): each group's first offered option in sort order; when that is over the cap, the
 * first combination under it (use, then term, then territory, each in sort order). No code is chosen yet. null when no
 * combination fits: the video can't be licensed.
 */
export function defaultSelection(
  options: EffectiveOptions,
  feeBps: number,
): Selection | null {
  const on = <G extends RateDimension>(group: G) =>
    options[group].filter((o) => o.enabled).map((o) => o.key as Keys[G]);
  for (const use of on("use")) {
    for (const term of on("term")) {
      for (const territory of on("territory")) {
        const selection = { use, term, territory, territoryCode: null };
        if (licenseCents(options, selection, feeBps) !== null) {
          return selection;
        }
      }
    }
  }
  return null;
}

const GROUPS = ["use", "term", "territory"] as const;

/**
 * `selection` again once the options changed under it (the page refreshed after an option_disabled, 01 J7.10): each
 * group whose option is gone moves to its first offered option; if that doesn't fit under the cap, the first load's
 * choice. `gone` names the groups that moved ("That option isn't available anymore."); none when it still fits.
 */
export function repairSelection(
  options: EffectiveOptions,
  selection: Selection,
  feeBps: number,
): { selection: Selection; gone: RateDimension[] } {
  if (licenseCents(options, selection, feeBps) !== null) {
    return { selection, gone: [] };
  }
  let next = selection;
  for (const group of GROUPS) {
    if (offered(options, group, next[group])) continue;
    const first = options[group].find((o) => o.enabled);
    if (first) next = withOption(next, group, first.key as Keys[typeof group]);
  }
  if (licenseCents(options, next, feeBps) === null) {
    // The loader 404s a video where nothing fits, so the first load's choice exists whenever this page renders.
    next = defaultSelection(options, feeBps) ?? next;
  }
  return {
    selection: next,
    gone: GROUPS.filter((group) => next[group] !== selection[group]),
  };
}

/**
 * A tile's delta (04 §9.3; 05 §4.1): the license price with `key` in `group` minus the current license price, each
 * rounded as the bar prints it (the license price, not the total). null when that option can't be bought.
 */
export function licenseDeltaCents<G extends RateDimension>(
  options: EffectiveOptions,
  selection: Selection,
  group: G,
  key: Keys[G],
  feeBps: number,
): number | null {
  const now = licenseCents(options, selection, feeBps);
  const then = licenseCents(options, withOption(selection, group, key), feeBps);
  return now === null || then === null ? null : then - now;
}

/** One country or One region with nothing chosen yet: the territory the button asks for ("Choose a country"). */
export const territoryToChoose = (selection: Selection) =>
  selection.territory !== "worldwide" && selection.territoryCode === null
    ? selection.territory
    : null;

/** The region a region license's code names, or null. */
const regionOf = (code: string | null) =>
  code !== null && isOneOf(REGION_KEYS, code) ? code : null;

/** A license's territory in labels: "Worldwide", "France", "North America (US & Canada)"; the tile before a pick. */
export function territoryLabel(
  territoryKey: RateOptionKey,
  territoryCode: string | null,
): string {
  const region = regionOf(territoryCode);
  if (territoryKey === "country" && territoryCode) {
    return countryName(territoryCode);
  }
  if (territoryKey === "region" && region) return REGIONS[region].label;
  return rateOptionLabel(territoryKey);
}

/**
 * The territory as a sentence names it after "in" (the license summary, /verify; owner answer Q-115 a): "the United
 * States", "the Middle East & Africa", "France"; Worldwide is "any country" ("in Worldwide" isn't English); before a
 * pick, the tile's label in lower case ("one country").
 */
export function territoryInSentence(
  territoryKey: TerritoryKey,
  territoryCode: string | null,
): string {
  const region = regionOf(territoryCode);
  if (territoryKey === "country" && territoryCode) {
    return countryInSentence(territoryCode);
  }
  if (territoryKey === "region" && region) {
    const { label } = REGIONS[region];
    return "the" in REGIONS[region] ? `the ${label}` : label;
  }
  return territoryKey === "worldwide"
    ? "any country"
    : rateOptionLabel(territoryKey).toLowerCase();
}

/**
 * "Paid social ads · 1 year · Worldwide", "… · France", "… · North America (US & Canada)": what the fake checkout, /r,
 * the inbox and the emails print. Takes stored rows' keys as they are (any rate option key, any code).
 */
export function scopeLabel(scope: {
  useKey: RateOptionKey;
  termKey: RateOptionKey;
  territoryKey: RateOptionKey;
  territoryCode: string | null;
}): string {
  return [
    rateOptionLabel(scope.useKey),
    rateOptionLabel(scope.termKey),
    territoryLabel(scope.territoryKey, scope.territoryCode),
  ].join(" · ");
}
