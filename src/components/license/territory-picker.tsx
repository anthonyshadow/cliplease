"use client";

import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { REGION_KEYS } from "@/lib/domain/values";
import { COUNTRIES, countryNamesIn } from "@/lib/licensing/countries";
import { LICENSE_PAGE_COPY } from "@/lib/licensing/license-page";
import { REGIONS } from "@/lib/licensing/options";

/** The territory select's id: the license page moves focus to it (a tap on One country or One region; P16a's button). */
export const TERRITORY_SELECT_ID = "territory-code";

/**
 * 04 §9.3 TerritoryPicker: the native select inside the selected One country or One region tile, its first option the
 * instruction (value "", left enabled so the tile never matches `:disabled`). Countries in list order (COUNTRIES is
 * stored sorted, so the server's and the browser's options agree); regions from REGIONS.
 */
export function TerritorySelect({
  territory,
  code,
  error,
  onChange,
}: {
  territory: "country" | "region";
  code: string | null;
  /** The server's "Choose a country." when none reached it. */
  error?: string;
  onChange: (code: string | null) => void;
}) {
  const words = LICENSE_PAGE_COPY[territory];
  const options =
    territory === "country"
      ? COUNTRIES.map((c) => ({ value: c.code, label: c.name }))
      : REGION_KEYS.map((key) => ({ value: key, label: REGIONS[key].label }));
  return (
    <SelectField
      id={TERRITORY_SELECT_ID}
      label={words.label}
      // Required for the request (04 §9.3); outside the form, so it only tells assistive tech.
      required
      error={error}
      value={code ?? ""}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">{words.choose}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </SelectField>
  );
}

/**
 * "Which countries?" (05 §4.1 callout 19): a Sheet listing each region and its countries (a bottom sheet below md, a
 * dialog from md, 07 D149). Esc closes it and focus returns to the link.
 */
export function CountriesSheet() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="link" size="sm" className="self-start">
          {LICENSE_PAGE_COPY.whichCountries}
        </Button>
      </SheetTrigger>
      <SheetContent title={LICENSE_PAGE_COPY.whichCountries}>
        {/* The list is taller than the sheet and holds nothing focusable: focusable itself, so the keyboard can scroll
            it in Safari too (WCAG 2.1.1; Chrome and Firefox do this for any scroller). */}
        <section
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must take focus to be scrolled by keyboard.
          tabIndex={0}
          aria-label={LICENSE_PAGE_COPY.whichCountries}
          data-focus="inset"
          className="flex flex-col gap-4"
        >
          {REGION_KEYS.map((key) => (
            <section key={key} className="flex flex-col gap-1">
              <h3 className="text-callout font-semibold text-ink">
                {REGIONS[key].label}
              </h3>
              <p className="text-callout text-ink-2">
                {countryNamesIn(key).join(", ")}
              </p>
            </section>
          ))}
        </section>
      </SheetContent>
    </Sheet>
  );
}
