import { TriangleAlert } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type DataColumn<Row> = {
  header: string;
  /** React key when headers repeat or are empty; defaults to `header`. */
  id?: string;
  /** A cell with nothing to show returns null: the table keeps it empty, a stacked row leaves its label out. */
  cell: (row: Row) => ReactNode;
  /** What the table prints in a cell that returns null (the admin's "—"); a stacked row still leaves its label out. */
  empty?: ReactNode;
  /** Numbers are right-aligned with tabular figures. */
  numeric?: boolean;
  /** "end": the table's cell (and header) right-aligned, as a row's trailing action (the admin's); start by default. */
  align?: "end";
  /**
   * A row action (a link or a button): last in a stacked row, with no label; its table header is for screen readers
   * only. A row whose action cells are all null has no actions line.
   */
  action?: boolean;
};

const keyOf = ({ id, header }: { id?: string; header: string }) => id ?? header;

/**
 * The warning icon and its word for screen readers, before a flagged row's first value: "Flagged. 12:39", so the word
 * never runs into the value.
 */
function FlagCue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <TriangleAlert
        aria-hidden
        size={16}
        strokeWidth={2}
        className="shrink-0"
      />
      <span className="sr-only">{`${label}. `}</span>
      {children}
    </span>
  );
}

export type DataTableProps<Row> = {
  /** Accessible name: the stacked list's label, the table's visually hidden caption. */
  caption: string;
  columns: readonly DataColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /**
   * A row that reads apart from the others (the admin's flagged Events rows, design/P21-admin-view.md §4.9): its word
   * for screen readers ("Flagged"), or null for a plain row. A flagged row is `data-tone="danger"`, its values in
   * `danger-text`, with a warning icon and the word before its first value, so the flag never relies on color alone; a
   * cell colored on its own yields to it through the row's `group/row` (`group-data-[tone=danger]/row:`).
   */
  rowFlag?: (row: Row) => string | null;
  /**
   * The table's columns as wide as their content, no cell wrapping: a wide table scrolls sideways in its wrapper
   * instead (the admin's, design §6). A stacked row still wraps.
   */
  nowrap?: boolean;
  className?: string;
};

/**
 * 04 §9.31 (07 D144, D146): below lg each row stacked, every label above its value (two columns of them from md) and the
 * row actions last; from lg a plain <table>, 48 px rows, hairline separators, row hover `fill`, which scrolls inside its
 * own wrapper when it is wider, never the page. CSS only: the form a tier doesn't use is display: none, so it is out of
 * the accessibility tree (`data-table-stacked`, `data-table-wide` name them for tests). Each cell renders once in each
 * form, so a cell never carries an id. Never shows tokens.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  rowFlag,
  nowrap = false,
  className,
}: DataTableProps<Row>) {
  const facts = columns.filter((column) => !column.action);
  const actions = columns.filter((column) => column.action);
  const lead = facts[0];
  /** `column`'s value for `row`, behind the flag's cue when it is the row's first value. */
  const cellValue = (
    column: DataColumn<Row>,
    row: Row,
    flag: string | null,
  ): ReactNode => {
    const value = column.cell(row);
    return flag && column === lead ? (
      <FlagCue label={flag}>{value}</FlagCue>
    ) : (
      value
    );
  };
  return (
    <div className={cn("w-full", className)}>
      <ul
        data-table-stacked
        aria-label={caption}
        className="flex flex-col lg:hidden"
      >
        {rows.map((row) => {
          const flag = rowFlag?.(row) ?? null;
          // A row with no action to offer (a revoked license's Revoke) has no actions line.
          const rowActions = actions
            .map((column) => ({ column, value: column.cell(row) }))
            .filter(({ value }) => value !== null);
          return (
            <li
              key={rowKey(row)}
              data-tone={flag ? "danger" : undefined}
              className="group/row flex flex-col gap-4 border-hairline px-3 py-4 [&+&]:border-t"
            >
              <dl className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-x-6">
                {facts.map((column) => {
                  const value = cellValue(column, row, flag);
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
                          flag && "text-danger-text",
                          column.numeric && "tabular-nums",
                        )}
                      >
                        {value}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              {rowActions.length > 0 ? (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  {rowActions.map(({ column, value }) => (
                    <Fragment key={keyOf(column)}>{value}</Fragment>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {/* relative: the wrapper holds the absolutely positioned sr-only text too (an action column's header), which would
          otherwise escape its scroll and widen the page. */}
      <div
        data-table-wide
        className="relative hidden w-full overflow-x-auto lg:block"
      >
        <table
          className={cn(
            "w-full border-collapse text-left",
            nowrap && "w-max min-w-full whitespace-nowrap",
          )}
        >
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-hairline">
              {columns.map((column) => (
                <th
                  key={keyOf(column)}
                  scope="col"
                  className={cn(
                    "h-10 px-3 text-footnote font-semibold text-ink-2",
                    (column.numeric || column.align === "end") && "text-right",
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
            {rows.map((row) => {
              const flag = rowFlag?.(row) ?? null;
              return (
                <tr
                  key={rowKey(row)}
                  data-tone={flag ? "danger" : undefined}
                  className="group/row h-12 border-b border-hairline hover:bg-fill"
                >
                  {columns.map((column) => (
                    <td
                      key={keyOf(column)}
                      className={cn(
                        "px-3 py-2 text-callout text-ink",
                        flag && "text-danger-text",
                        column.numeric && "text-right tabular-nums",
                        column.align === "end" && "text-right",
                      )}
                    >
                      {cellValue(column, row, flag) ?? column.empty ?? null}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
