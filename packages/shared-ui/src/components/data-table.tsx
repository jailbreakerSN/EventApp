"use client";

import * as React from "react";
import { cn } from "../lib/utils";
import { Skeleton } from "./skeleton";
import { EmptyState } from "./empty-state";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
}

export interface DataTableProps<T> extends React.HTMLAttributes<HTMLDivElement> {
  columns: DataTableColumn<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  /** Accessible label for screen readers (e.g. "Liste des événements") */
  "aria-label"?: string;
}

function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  loading = false,
  emptyMessage = "Aucune donnée",
  className,
  "aria-label": ariaLabel,
  ...props
}: DataTableProps<T>) {
  return (
    <div
      className={cn("w-full overflow-auto rounded-md border border-border", className)}
      role="region"
      aria-label={ariaLabel}
      {...props}
    >
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
                        {col.render ? col.render(item) : ((item[col.key] as React.ReactNode) ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
        </tbody>
      </table>

      {!loading && data.length === 0 && <EmptyState title={emptyMessage} className="py-8" />}
    </div>
  );
}
DataTable.displayName = "DataTable";

export { DataTable };
