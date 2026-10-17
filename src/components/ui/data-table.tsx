import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type DataColumn<Row> = {
  header: string;
  cell: (row: Row) => ReactNode;
  /** Numbers are right-aligned with tabular figures. */
  numeric?: boolean;
};

/** 04 §9.31: a plain <table> for admin; 48 px rows, hairline separators, row hover `fill`. Never shows tokens. */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  className,
}: {
  /** Accessible name; visually hidden. */
  caption: string;
  columns: readonly DataColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  className?: string;
}) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-hairline">
            {columns.map((column) => (
              <th
                key={column.header}
                scope="col"
                className={cn(
                  "h-10 px-3 text-footnote font-semibold text-ink-2",
                  column.numeric && "text-right",
                )}
              >
                {column.header}
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
                  key={column.header}
                  className={cn(
                    "px-3 text-callout text-ink",
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
  );
}
