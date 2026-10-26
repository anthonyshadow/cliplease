// The license summary as a buyer reads it (01 §4.7; 04 §9.5): License v1's summary template filled from a choice and the
// video's flags. Pure, so the license page fills it live and /l and the PDF (P20) fill it from a snapshot.
import { APP_NAME } from "../app-name";
import type { TermKey, TerritoryKey, UseKey } from "../domain/values";
import {
  fillLicenseV1,
  LICENSE_V1_SUMMARY,
  type LicenseSummaryRow,
} from "../legal/license-v1-summary";
import { rateOptionLabel, rateOptionOneLiner } from "./options";
import { territoryInSentence, territoryLabel } from "./selection";

export type SummaryInput = {
  useKey: UseKey;
  termKey: TermKey;
  territoryKey: TerritoryKey;
  territoryCode: string | null;
  handle: string;
  /** creditLine()'s bare line; the summary adds the quotes. */
  creditLine: string;
  containsMusic: boolean;
  identifiablePeople: boolean;
  /** What follows the territory: the page's "for 1 year from approval" by default; P20 passes "until 20 Nov 2027". */
  termPhrase?: string;
};

export type FilledSummary = {
  heading: string;
  groups: { title: string; rows: { label: string; text: string }[] }[];
  /** "This summary is not the license." and the link that names the legal text. */
  footer: { note: string; link: { text: string; href: string } };
};

/** "for 1 year from approval" · "with no end date" (01 §4.7's {for {term_label} from approval | with no end date}). */
export const termPhrase = (termKey: TermKey) =>
  termKey === "perpetual"
    ? "with no end date"
    : `for ${rateOptionLabel(termKey)} from approval`;

// The footer template ends "…: /legal/license/v1"; 04 §9.5 makes the sentence before the colon the link.
const FOOTER = /^(.+?\.) (.+): (\/\S+)$/;

/**
 * The summary for a standard license (the exclusive and renewal rows are P19f's and P22c's): rows show when they have
 * no condition, are the standard row, or match the video's music or people flag; a group with no rows is left out.
 */
export function licenseSummary(input: SummaryInput): FilledSummary {
  const values = {
    app_name: APP_NAME,
    use_label: rateOptionLabel(input.useKey),
    term_label: rateOptionLabel(input.termKey),
    territory_label: territoryLabel(input.territoryKey, input.territoryCode),
    territory: territoryInSentence(input.territoryKey, input.territoryCode),
    // The one-liner is a sentence of its own; the row goes on after it.
    use_one_liner: rateOptionOneLiner(input.useKey).replace(/\.$/, ""),
    term_phrase: input.termPhrase ?? termPhrase(input.termKey),
    creator_handle: `@${input.handle}`,
    credit_line: `“${input.creditLine}”`,
  };
  const shown = ({ when }: LicenseSummaryRow) =>
    when === undefined ||
    when === "standard" ||
    (when === "contains_music" && input.containsMusic) ||
    (when === "identifiable_people" && input.identifiablePeople);
  const fill = (text: string) => fillLicenseV1(text, values);
  const footer = FOOTER.exec(fill(LICENSE_V1_SUMMARY.footer));
  if (!footer) throw new Error("License v1: the summary footer changed shape");
  return {
    heading: fill(LICENSE_V1_SUMMARY.heading),
    groups: LICENSE_V1_SUMMARY.groups
      .map((group) => ({
        title: group.title,
        rows: group.rows
          .filter(shown)
          .map((row) => ({ label: row.label, text: fill(row.text) })),
      }))
      .filter((group) => group.rows.length > 0),
    footer: { note: footer[1], link: { text: footer[2], href: footer[3] } },
  };
}
