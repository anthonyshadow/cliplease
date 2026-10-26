import { useId } from "react";
import { FactList } from "@/components/ui/fact-list";
import { INLINE_LINK } from "@/components/ui/inline-link";
import type { Currency } from "@/lib/domain/values";
import { LICENSE_PAGE_COPY } from "@/lib/licensing/license-page";
import type { FilledSummary } from "@/lib/licensing/summary";

/**
 * 04 §9.5 LicenseSummary: licenseSummary()'s heading, its groups as FactList rows, the link to the legal text (in a new
 * tab, so the page keeps the buyer's choices) and "Prices in Canadian dollars (CAD).". No aria-live: the PriceBar
 * announces. Presentational, so /l (P20) can show a license's summary too.
 */
export function LicenseSummary({
  summary,
  currency,
}: {
  summary: FilledSummary;
  currency: Currency;
}) {
  const headingId = useId();
  const { link } = summary.footer;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-md bg-fill p-4"
    >
      <h2 id={headingId} className="text-callout font-semibold text-ink">
        {summary.heading}
      </h2>
      {summary.groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-2">
          <h3 className="text-footnote font-semibold text-ink-2">
            {group.title}
          </h3>
          <FactList
            variant="summary"
            facts={group.rows.map((row) => ({
              label: row.label,
              value: row.text,
            }))}
          />
        </div>
      ))}
      <p className="text-callout text-ink-2">
        {`${summary.footer.note} `}
        <a
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${link.text} (opens in a new tab)`}
          className={INLINE_LINK}
        >
          {link.text}
        </a>
      </p>
      <p className="text-footnote text-ink-2">
        {LICENSE_PAGE_COPY.pricesIn(currency)}
      </p>
    </section>
  );
}
