// The license page's choice (01 J7; 04 §9.3; 05 §4.1; P15): the buyer's selection, its quote, the tiles each group
// offers with their deltas, and the scope label the checkout, /r, the inbox and the emails print. Every price goes
// through quoteFor, so the bar, the deltas and the cap filter can't disagree. Pure, for the server and the browser.
import type { EffectiveOptions } from "../../server/pricing/rate-card";
import {
  EXCLUSIVE_TERM_KEYS,
  type ExclusiveTermKey,
  isOneOf,
  RATE_DIMENSIONS,
  type RateDimension,
  type RateOptionKey,
  REGION_KEYS,
  type TermKey,
  type TerritoryKey,
  type UseKey,
} from "../domain/values";
import { computeQuote, type QuoteResult } from "../pricing/compute-quote";
import { isExclusiveTermKey } from "../pricing/exclusive";
import { NON_EXCLUSIVE_BPS, PLATFORM_FEE_MIN_CENTS } from "../pricing/presets";
import type { LicenseAvailability } from "./availability";
import { countryInSentence, countryName } from "./countries";
import { LICENSE_PAGE_COPY } from "./license-page";
import { REGIONS, rateOptionLabel } from "./options";

/**
 * What the buyer has picked. `territoryCode`: an ISO code (country), a region key (region), else null. `exclusive`: the
 * License type group's choice (07 D109, D112).
 */
export type Selection = {
  use: UseKey;
  term: TermKey;
  territory: TerritoryKey;
  territoryCode: string | null;
  exclusive: boolean;
};

type Keys = { use: UseKey; term: TermKey; territory: TerritoryKey };

/** The License type group's tiles. */
export type LicenseTypeKey = "standard" | "exclusive";

/** Each group's tile keys, the License type group's included: what a delta takes. */
export type TileKeys = Keys & { type: LicenseTypeKey };

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
  selection: Keys,
): { useBps: number; termBps: number; territoryBps: number } | null {
  const use = offered(options, "use", selection.use);
  const term = offered(options, "term", selection.term);
  const territory = offered(options, "territory", selection.territory);
  return use && term && territory
    ? { useBps: use.bps, termBps: term.bps, territoryBps: territory.bps }
    : null;
}

/** The premium a request is priced with and snapshots (07 D109): the offer's, or NON_EXCLUSIVE_BPS for a standard license. */
export const exclusiveBpsOf = (
  options: EffectiveOptions,
  exclusive: boolean,
) => (exclusive ? options.exclusive.multiplierBps : NON_EXCLUSIVE_BPS);

/**
 * The quote for `selection` (computeQuote over the effective base, incl. a video's own base, 07 D82, D97; an exclusive
 * one with the premium, 07 D109), or null when one of its options isn't offered or an exclusive license can't last its
 * term (07 D112). The territory code never changes the price: "One country" is priced before a country is chosen.
 */
export function quoteFor(
  options: EffectiveOptions,
  selection: Keys & Pick<Selection, "exclusive">,
  fees: FeeTerms,
): QuoteResult | null {
  if (selection.exclusive && !isExclusiveTermKey(selection.term)) return null;
  const multipliers = chosenMultipliers(options, selection);
  if (!multipliers) return null;
  return computeQuote({
    currency: options.currency,
    basePriceCents: options.basePriceCents,
    ...multipliers,
    exclusiveBps: exclusiveBpsOf(options, selection.exclusive),
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

/**
 * A tile: the option, or one shown disabled with its reason: a use the video's music turns off (01 J5.14), a term an
 * exclusive license can't last (07 D112).
 */
export type OfferedOption<K extends RateOptionKey> = {
  key: K;
  label: string;
  enabled: boolean;
  disabledReason?: "music" | "exclusive_term";
};

export type OfferedOptions = {
  use: OfferedOption<UseKey>[];
  term: OfferedOption<TermKey>[];
  territory: OfferedOption<TerritoryKey>[];
};

/**
 * Each group's tiles for `selection` (04 §9.3; 07 D22, D82), in sort order: the options the creator offers, minus any
 * that would put the total over the cap with the other two current choices and the premium; a music-disabled use stays
 * as a disabled tile, and so does a term an exclusive selection can't have, whatever the cap says. Options the creator
 * turned off are absent.
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
      if (
        group === "term" &&
        selection.exclusive &&
        !isOneOf(EXCLUSIVE_TERM_KEYS, o.key)
      ) {
        return [
          {
            key,
            label: o.label,
            enabled: false,
            disabledReason: "exclusive_term",
          },
        ];
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
 * first combination under it (use, then term, then territory, each in sort order). No code is chosen yet, and Exclusive
 * is never pre-selected. null when no combination fits: the video can't be licensed.
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
        const selection = {
          use,
          term,
          territory,
          territoryCode: null,
          exclusive: false,
        };
        if (licenseCents(options, selection, feeBps) !== null) {
          return selection;
        }
      }
    }
  }
  return null;
}

/**
 * `selection` again once the options or the video's availability changed under it (the page refreshed after a refusal,
 * 01 J7.10; 07 D110): an Exclusive the video can't take any more is dropped; then, if it doesn't fit, each group whose
 * option is gone moves to its first offered option; an Exclusive that still has no price (over the cap, or the term moved
 * to Perpetual) is dropped; and if that doesn't fit under the cap, the first load's choice, with the buyer's country or
 * region kept when that choice keeps their territory (a code never changes the price). `gone` names what moved ("That
 * option isn't available anymore."); nothing when it still fits.
 */
export function repairSelection(
  options: EffectiveOptions,
  selection: Selection,
  availability: Pick<LicenseAvailability, "canRequestExclusive">,
  feeBps: number,
): { selection: Selection; gone: (RateDimension | "exclusive")[] } {
  const fits = (s: Selection) => licenseCents(options, s, feeBps) !== null;
  let next =
    selection.exclusive && !availability.canRequestExclusive
      ? { ...selection, exclusive: false }
      : selection;
  if (!fits(next)) {
    for (const group of RATE_DIMENSIONS) {
      if (offered(options, group, next[group])) continue;
      const first = options[group].find((o) => o.enabled);
      if (first) {
        next = withOption(next, group, first.key as Keys[typeof group]);
      }
    }
    if (next.exclusive && !fits(next)) next = { ...next, exclusive: false };
    if (!fits(next)) {
      // The loader 404s a video where nothing fits, so the first load's choice exists whenever this page renders.
      const first = defaultSelection(options, feeBps) ?? next;
      next =
        first.territory === selection.territory
          ? { ...first, territoryCode: selection.territoryCode }
          : first;
    }
  }
  const groupsMoved = RATE_DIMENSIONS.filter(
    (group) => next[group] !== selection[group],
  );
  return {
    selection: next,
    gone:
      selection.exclusive && !next.exclusive
        ? [...groupsMoved, "exclusive"]
        : groupsMoved,
  };
}

/** Where a term an exclusive license can't last moves when the buyer picks Exclusive: the longest one on (OQ-57). */
const EXCLUSIVE_TERMS_LONGEST_FIRST = [
  "y1",
  "m6",
  "d30",
] as const satisfies readonly ExclusiveTermKey[];

/**
 * `selection` with the license type chosen (OQ-57; 04 §9.35): Exclusive from a term it can't last (Perpetual) moves to
 * the longest exclusive term on, and `movedTermKey` says so. The cap plays no part: licenseTypeOptions hides a tile the
 * move would put over it. Standard keeps the term, and Perpetual comes back as a choice, never re-selected.
 */
export function selectLicenseType(
  options: EffectiveOptions,
  selection: Selection,
  exclusive: boolean,
): { selection: Selection; movedTermKey: ExclusiveTermKey | null } {
  const movedTermKey =
    exclusive && !isExclusiveTermKey(selection.term)
      ? (EXCLUSIVE_TERMS_LONGEST_FIRST.find((key) =>
          offered(options, "term", key),
        ) ?? null)
      : null;
  return {
    selection: {
      ...selection,
      exclusive,
      term: movedTermKey ?? selection.term,
    },
    movedTermKey,
  };
}

/** A License type tile (04 §9.35). */
export type LicenseTypeTile = {
  key: LicenseTypeKey;
  enabled: boolean;
  disabledReason?: "availability";
};

/**
 * The License type group's tiles (04 §9.35; 07 D22, D110): none unless the creator offers exclusive licenses. Exclusive
 * is disabled while the video can't take one, whatever its price; otherwise it is hidden when its combination, after
 * the term move, is over the cap.
 */
export function licenseTypeOptions(
  options: EffectiveOptions,
  selection: Selection,
  availability: Pick<LicenseAvailability, "canRequestExclusive">,
  feeBps: number,
): LicenseTypeTile[] {
  if (!options.exclusive.offered) return [];
  const standard: LicenseTypeTile = { key: "standard", enabled: true };
  if (!availability.canRequestExclusive) {
    return [
      standard,
      { key: "exclusive", enabled: false, disabledReason: "availability" },
    ];
  }
  const moved = selectLicenseType(options, selection, true).selection;
  return licenseCents(options, moved, feeBps) === null
    ? [standard]
    : [standard, { key: "exclusive", enabled: true }];
}

/**
 * A tile's delta (04 §9.3, §9.35; 05 §4.1): the license price with `key` in `group` minus the current license price,
 * each rounded as the bar prints it (the license price, not the total), so Exclusive's from Perpetual includes the term
 * move. null when that option can't be bought.
 */
export function licenseDeltaCents<G extends RateDimension | "type">(
  options: EffectiveOptions,
  selection: Selection,
  group: G,
  key: TileKeys[G],
  feeBps: number,
): number | null {
  const now = licenseCents(options, selection, feeBps);
  const picked =
    group === "type"
      ? selectLicenseType(options, selection, key === "exclusive").selection
      : withOption(
          selection,
          group as RateDimension,
          key as Keys[RateDimension],
        );
  const then = licenseCents(options, picked, feeBps);
  return now === null || then === null ? null : then - now;
}

/** What the live region says when Exclusive moved the term (04 §11.2 for "1 year"; owner answer Q-168 for the others). */
export function termMovedMessage(termLabel: string): string {
  return `Term changed to ${termLabel}. ${LICENSE_PAGE_COPY.exclusiveTerm}`;
}

/** The Checkout line item: "{title} · {scopeLabel}", prefixed "Exclusive license · " when exclusive (07 D113). */
export function licenseLineLabel(line: {
  title: string;
  scopeLabel: string;
  exclusive: boolean;
}): string {
  const label = `${line.title} · ${line.scopeLabel}`;
  return line.exclusive ? `Exclusive license · ${label}` : label;
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
