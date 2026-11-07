import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type DataColumn<Row> = {
  header: string;
  /** React key when headers repeat or are empty; defaults to `header`. */
  id?: string;
  /** A cell with nothing to show returns null: the table keeps it empty, a stacked row leaves its label out. */
  cell: (row: Row) => ReactNode;
  /** Numbers are right-aligned with tabular figures. */
  numeric?: boolean;
  /** A row action (a link): last in a stacked row, with no label; its table header is for screen readers only. */
  action?: boolean;
};

const keyOf = ({ id, header }: { id?: string; header: string }) => id ?? header;

/**
 * 04 §9.31 (07 D144, D146): below lg each row stacked, every label above its value (two columns of them from md) and the
 * row actions last; from lg a plain <table>, 48 px rows, hairline separators, row hover `fill`, which scrolls inside its
 * own wrapper when it is wider, never the page. CSS only: the form a tier doesn't use is display: none, so it is out of
 * the accessibility tree (`data-table-stacked`, `data-table-wide` name them for tests). Never shows tokens.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  className,
}: {
  /** Accessible name: the stacked list's label, the table's visually hidden caption. */
  caption: string;
  columns: readonly DataColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  className?: string;
}) {
  const facts = columns.filter((column) => !column.action);
  const actions = columns.filter((column) => column.action);
  return (
    <div className={cn("w-full", className)}>
      <ul
        data-table-stacked
        aria-label={caption}
        className="flex flex-col lg:hidden"
      >
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            className="flex flex-col gap-4 border-hairline px-3 py-4 [&+&]:border-t"
          >
            <dl className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-x-6">
              {facts.map((column) => {
                const value = column.cell(row);
                return value === null ? null : (
                  <div
                    key={keyOf(column)}
                    className="flex min-w-0 flex-col gap-1"
                  >
                    <dt className="text-footnote font-semibold text-ink-2">
                      {column.header}
                    </dt>
                    <dd
                      className={cn(
                        "text-callout text-ink wrap-anywhere",
                        column.numeric && "tabular-nums",
                      )}
                    >
                      {value}
                    </dd>
                  </div>
                );
              })}
            </dl>
            {actions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                {actions.map((column) => (
                  <Fragment key={keyOf(column)}>{column.cell(row)}</Fragment>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <div data-table-wide className="hidden w-full overflow-x-auto lg:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-hairline">
              {columns.map((column) => (
                <th
                  key={keyOf(column)}
                  scope="col"
                  className={cn(
                    "h-10 px-3 text-footnote font-semibold text-ink-2",
                    column.numeric && "text-right",
                  )}
                >
                  {column.action ? (
                    <span className="sr-only">{column.header}</span>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="h-12 border-b border-hairline hover:bg-fill"
              >
                {columns.map((column) => (
                  <td
                    key={keyOf(column)}
                    className={cn(
                      "px-3 py-2 text-callout text-ink",
                      column.numeric && "text-right tabular-nums",
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
