// What buyers see for each option (research/license.md §2; 07 D04): labels only, keyed by the values.ts types. The
// license text (src/lib/legal/license-v1.ts) is versioned and keeps its own wording.
import type {
  RateDimension,
  RateOptionKey,
  RegionKey,
  TermKey,
  TerritoryKey,
  UseKey,
} from "../domain/values";

type Labelled = { label: string };

/** The three groups a license is priced by (the rate card's sections, the preview's pickers). */
export const DIMENSION_LABELS = {
  use: "Use",
  term: "Term",
  territory: "Territory",
} as const satisfies Record<RateDimension, string>;

export const USE_OPTIONS = {
  organic_social: { label: "Organic social repost" },
  paid_social: { label: "Paid social ads" },
  broadcast: { label: "TV / broadcast" },
} as const satisfies Record<UseKey, Labelled>;

export const TERM_OPTIONS = {
  d30: { label: "30 days" },
  m6: { label: "6 months" },
  y1: { label: "1 year" },
  perpetual: { label: "Perpetual" },
} as const satisfies Record<TermKey, Labelled>;

export const TERRITORY_OPTIONS = {
  country: { label: "One country" },
  region: { label: "One region" },
  worldwide: { label: "Worldwide" },
} as const satisfies Record<TerritoryKey, Labelled>;

export const REGIONS = {
  north_america: { label: "North America (US & Canada)" },
  latam_caribbean: { label: "Latin America & Caribbean" },
  europe: { label: "Europe" },
  middle_east_africa: { label: "Middle East & Africa" },
  asia_pacific: { label: "Asia-Pacific" },
} as const satisfies Record<RegionKey, Labelled>;

const RATE_OPTIONS = {
  ...USE_OPTIONS,
  ...TERM_OPTIONS,
  ...TERRITORY_OPTIONS,
} satisfies Record<RateOptionKey, Labelled>;

/** "paid_social" → "Paid social ads": the label of any rate card option. */
export function rateOptionLabel(key: RateOptionKey): string {
  return RATE_OPTIONS[key].label;
}
