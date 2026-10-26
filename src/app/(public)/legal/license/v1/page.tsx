import type { Metadata } from "next";
import { LegalPage } from "@/components/layout/legal-page";
import {
  LICENSE_V1_NEUTRAL_VALUES,
  LICENSE_V1_SCHEDULE_A,
  LICENSE_V1_SECTIONS,
} from "@/lib/legal/license-v1";
import {
  fillLicenseV1,
  LICENSE_V1_DISPLAY_TITLE,
  LICENSE_V1_SUMMARY,
  type LicenseSummaryRow,
} from "@/lib/legal/license-v1-summary";
import { mapSections } from "@/lib/legal/types";

export const metadata: Metadata = {
  title: { absolute: LICENSE_V1_DISPLAY_TITLE },
};

// The text of License v1 with neutral words in place of a license's own values (license.md §4 (a)).
const fill = (text: string) => fillLicenseV1(text, LICENSE_V1_NEUTRAL_VALUES);
const sections = mapSections(
  [...LICENSE_V1_SECTIONS, LICENSE_V1_SCHEDULE_A],
  fill,
);

const WHEN: Record<NonNullable<LicenseSummaryRow["when"]>, string> = {
  standard: "standard license",
  exclusive: "exclusive license",
  auto_renew: "when auto-renewal is on",
  contains_music: "when the video contains music",
  identifiable_people: "when people in the video can be identified",
};

function LicenseSummary() {
  return (
    <section
      aria-labelledby="summary-title"
      className="flex flex-col gap-4 rounded-md border border-hairline p-4"
    >
      <h2 id="summary-title" className="text-title-2 text-ink">
        License summary
      </h2>
      {LICENSE_V1_SUMMARY.groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <h3 className="text-body font-semibold text-ink">{group.title}</h3>
          <ul className="flex flex-col gap-1">
            {group.rows.map((row) => (
              <li key={row.label}>
                <span className="font-semibold">{row.label}</span>
                {` — ${fill(row.text)}${row.when ? ` (${WHEN[row.when]})` : ""}`}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-callout text-ink-2">
        {fill(LICENSE_V1_SUMMARY.footer)}
      </p>
    </section>
  );
}

export default function LicenseV1Page() {
  return (
    <LegalPage
      title={LICENSE_V1_DISPLAY_TITLE}
      intro={<LicenseSummary />}
      sections={sections}
    />
  );
}
