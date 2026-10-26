// What buyers see for each option (research/license.md §2; 07 D04): labels and the one sentence under each license page
// tile (01 §4.1–§4.3, P15), keyed by the values.ts types. The license text (src/lib/legal/license-v1.ts) is versioned and
// keeps its own wording.
import type {
  RateDimension,
  RateOptionKey,
  RegionKey,
  TermKey,
  TerritoryKey,
  UseKey,
} from "../domain/values";

type Labelled = { label: string };
type Described = Labelled & { oneLiner: string };

/** The three groups a license is priced by (the rate card's sections, the preview's pickers). */
export const DIMENSION_LABELS = {
  use: "Use",
  term: "Term",
  territory: "Territory",
} as const satisfies Record<RateDimension, string>;

export const USE_OPTIONS = {
  organic_social: {
    label: "Organic social repost",
    oneLiner:
      "Post it on your own social media accounts, without paying to promote it.",
  },
  paid_social: {
    label: "Paid social ads",
    oneLiner:
      "Everything in organic, plus running it as ads or boosted posts on social platforms from your own ad accounts.",
  },
  broadcast: {
    label: "TV / broadcast",
    oneLiner:
      "Everything in organic, plus showing it inside TV programs on air and on your own streaming or catch-up services.",
  },
} as const satisfies Record<UseKey, Described>;

export const TERM_OPTIONS = {
  d30: {
    label: "30 days",
    oneLiner: "Use it for 30 days from approval, then take it down.",
  },
  m6: {
    label: "6 months",
    oneLiner: "Use it for 6 months from approval, then take it down.",
  },
  y1: {
    label: "1 year",
    oneLiner: "Use it for 1 year from approval, then take it down.",
  },
  perpetual: {
    label: "Perpetual",
    oneLiner: "Use it with no end date, as long as you keep to the license.",
  },
} as const satisfies Record<TermKey, Described>;

export const TERRITORY_OPTIONS = {
  country: {
    label: "One country",
    oneLiner:
      "Aim your use at one country you choose. That covers ads targeted there, broadcasts there, and posts from accounts that serve that country's audience.",
  },
  region: {
    label: "One region",
    oneLiner:
      "The same, for one of five regions: North America, Latin America & Caribbean, Europe, Middle East & Africa, or Asia-Pacific.",
  },
  worldwide: { label: "Worldwide", oneLiner: "Use it anywhere." },
} as const satisfies Record<TerritoryKey, Described>;

/** The five regions; `the`: a sentence names it with "the" ("in the Middle East & Africa", owner answer Q-115 a). */
export const REGIONS = {
  north_america: { label: "North America (US & Canada)" },
  latam_caribbean: { label: "Latin America & Caribbean" },
  europe: { label: "Europe" },
  middle_east_africa: { label: "Middle East & Africa", the: true },
  asia_pacific: { label: "Asia-Pacific" },
} as const satisfies Record<RegionKey, Labelled & { the?: true }>;

const RATE_OPTIONS = {
  ...USE_OPTIONS,
  ...TERM_OPTIONS,
  ...TERRITORY_OPTIONS,
} satisfies Record<RateOptionKey, Described>;

/** "paid_social" → "Paid social ads": the label of any rate card option. */
export function rateOptionLabel(key: RateOptionKey): string {
  return RATE_OPTIONS[key].label;
}

/** The sentence under an option's license page tile (01 §4.1–§4.3). */
export function rateOptionOneLiner(key: RateOptionKey): string {
  return RATE_OPTIONS[key].oneLiner;
}
