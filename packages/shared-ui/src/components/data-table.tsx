"use client";

import * as React from "react";
import { cn } from "../lib/utils";
import { Skeleton } from "./skeleton";
import { EmptyState } from "./empty-state";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  /** If true, this column is shown in the card header on mobile (default: first column) */
  primary?: boolean;
  /** If true, hide this column in mobile card mode */
  hideOnMobile?: boolean;
}

export interface DataTableProps<T> extends React.HTMLAttributes<HTMLDivElement> {
  columns: DataTableColumn<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  /** Accessible label for screen readers (e.g. "Liste des événements") */
  "aria-label"?: string;
  /** Enable responsive card layout on small screens (default: false) */
  responsiveCards?: boolean;
}

function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  loading = false,
  emptyMessage = "Aucune donnée",
  className,
  "aria-label": ariaLabel,
  responsiveCards = false,
  ...props
}: DataTableProps<T>) {
  const primaryCol = columns.find((c) => c.primary) ?? columns[0];
  const detailCols = responsiveCards
    ? columns.filter((c) => c !== primaryCol && !c.hideOnMobile)
    : columns;

  const renderCellValue = (col: DataTableColumn<T>, item: T) =>
    col.render ? col.render(item) : ((item[col.key] as React.ReactNode) ?? "");

  return (
    <div
      className={cn("w-full rounded-md border border-border", className)}
      role="region"
      aria-label={ariaLabel}
      {...props}
    >
      {/* ── Desktop: standard table ── */}
      <div className={cn("overflow-auto", responsiveCards && "hidden md:block")}>
        <table
          className="w-full caption-bottom text-sm"
          aria-rowcount={data.length}
          aria-colcount={columns.length}
        >
          <thead className="bg-muted/50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className="h-10 px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap"
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, rowIdx) => (
                  <tr key={rowIdx} className="border-t border-border">
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3">
                        <Skeleton className="h-4 w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              : data.length === 0
                ? null
                : data.map((item, rowIdx) => (
                    <tr
                      key={rowIdx}
                      className="border-t border-border transition-colors hover:bg-muted/50"
                    >
                      {columns.map((col) => (
                        <td key={col.key} className="px-4 py-3 text-foreground align-middle">
                          {renderCellValue(col, item)}
                        </td>
                      ))}
                    </tr>
                  ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile: stacked card layout ── */}
      {responsiveCards && (
        <div className="md:hidden divide-y divide-border">
          {loading
            ? Array.from({ length: 3 }).map((_, idx) => (
                <div key={idx} className="p-4 space-y-2">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ))
            : data.length === 0
              ? null
              : data.map((item, rowIdx) => (
                  <div key={rowIdx} className="p-4 space-y-1.5">
                    <div className="font-medium text-foreground">
                      {renderCellValue(primaryCol, item)}
                    </div>
                    {detailCols.map((col) => (
                      <div key={col.key} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{col.header}</span>
                        <span className="text-foreground text-right max-w-[60%] truncate">
                          {renderCellValue(col, item)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
        </div>
      )}

      {!loading && data.length === 0 && <EmptyState title={emptyMessage} className="py-8" />}
    </div>
  );
}
DataTable.displayName = "DataTable";

export { DataTable };
