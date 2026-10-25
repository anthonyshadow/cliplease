import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { connectStartHref } from "@/components/connections/connect-messages";
import {
  BLOCKERS_HEADING_ID,
  type BlockerRow,
  REVIEW_COPY,
} from "@/lib/videos/review";
import { FocusBlockersOnArrival } from "./focus-blockers-on-arrival";

const ROW =
  "flex min-h-11 w-full items-center justify-between gap-3 py-2 text-callout text-ink";

const hrefOf = (row: BlockerRow) =>
  row.kind === "reconnect"
    ? connectStartHref(row.platform, row.returnTo)
    : row.href;

/**
 * "Before you can publish" (05 §6.5 callout 51): one navigational row per blocker, each going where it is fixed. A page
 * goes through the router; an anchor on this page and a connect (07 D37's start route) are plain links. Opened at
 * `#publish-blockers`, its heading takes the focus.
 */
export function ReviewBlockers({ rows }: { rows: readonly BlockerRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section
      aria-labelledby={BLOCKERS_HEADING_ID}
      data-publish-blockers
      className="flex flex-col gap-1 rounded-lg border border-hairline p-4"
    >
      <h2
        id={BLOCKERS_HEADING_ID}
        tabIndex={-1}
        className="text-callout font-semibold text-ink outline-none"
      >
        {REVIEW_COPY.blockersTitle}
      </h2>
      <FocusBlockersOnArrival />
      <ul className="flex flex-col divide-y divide-hairline">
        {rows.map((row) => {
          const content = (
            <>
              <span className="min-w-0">{row.label}</span>
              <ChevronRight
                aria-hidden
                size={20}
                className="shrink-0 text-ink-2"
              />
            </>
          );
          return (
            <li key={row.key}>
              {row.kind === "page" ? (
                <Link href={row.href} className={ROW}>
                  {content}
                </Link>
              ) : (
                <a href={hrefOf(row)} className={ROW}>
                  {content}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
