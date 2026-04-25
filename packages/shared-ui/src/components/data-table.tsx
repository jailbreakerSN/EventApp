"use client";

import * as React from "react";
import { cn } from "../lib/utils";
import { Skeleton } from "./skeleton";
import { EmptyState } from "./empty-state";

export interface DataTableColumn<T> {
  key: string;
  /**
   * Column header. Historically a string; now accepts a ReactNode too so
   * callers can render a select-all checkbox, an info tooltip, or any
   * inline control alongside the label. The mobile card layout continues
   * to expect a displayable value — a plain string still works there.
   */
  header: React.ReactNode;
  render?: (item: T) => React.ReactNode;
  /** If true, this column is shown in the card header on mobile (default: first column) */
  primary?: boolean;
  /** If true, hide this column in mobile card mode */
  hideOnMobile?: boolean;
  /**
   * When the table has `onRowClick` set, clicks that originate INSIDE
   * this column do NOT trigger the row handler. Use for "Actions"
   * columns with their own buttons (Edit / Suspend / Delete) so
   * pressing the action doesn't also navigate to the detail page.
   * Industry precedent: Stripe Dashboard, Linear, Notion.
   */
  stopRowNavigation?: boolean;
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
  /**
   * Row-level click handler — the canonical admin-list pattern.
   *
   * When set, each row becomes an interactive region:
   *   - Mouse click anywhere in the row invokes the handler, EXCEPT
   *     inside cells belonging to a column flagged
   *     `stopRowNavigation: true` (action buttons, kebabs, inline
   *     controls that have their own meaning).
   *   - Keyboard: the row is focusable (`tabIndex=0`) and Enter or
   *     Space triggers the handler.
   *   - ARIA: the row announces as a button so assistive tech
   *     exposes the activation semantics.
   *
   * Callers should USUALLY pair this with a `<Link href=…>` wrapping
   * the primary column's content so middle-click / cmd-click open
   * the detail page in a new tab — the row click covers mouse +
   * keyboard, the Link covers the "open in new tab" admin workflow.
   * Both point at the same URL; Next.js deduplicates the navigation.
   *
   * Returning early inside the handler is fine when you want to
   * disable navigation for a specific row (e.g. archived rows).
   */
  onRowClick?: (row: T) => void;
  /**
   * Sprint-1 B2 closure — index of the row currently highlighted by a
   * page-level keyboard navigation hook (`useRowKeyboardNav`). When
   * set, the matching row gets a visible accent so power users know
   * which row Enter / Space will activate. -1 disables the
   * highlight. Mouse hover takes precedence visually because hover
   * also drives most operators' attention.
   */
  activeRowIndex?: number;
  /**
   * Sprint-1 B2 closure — fired when the operator moves the mouse
   * over a row. Lets a page sync its keyboard cursor with the mouse
   * cursor so j/k after a hover keeps a coherent context.
   */
  onRowHover?: (rowIndex: number) => void;
}

function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  loading = false,
  emptyMessage = "Aucune donnée",
  className,
  "aria-label": ariaLabel,
  responsiveCards = false,
  onRowClick,
  activeRowIndex = -1,
  onRowHover,
  ...props
}: DataTableProps<T>) {
  const primaryCol = columns.find((c) => c.primary) ?? columns[0];
  const detailCols = responsiveCards
    ? columns.filter((c) => c !== primaryCol && !c.hideOnMobile)
    : columns;

  const renderCellValue = (col: DataTableColumn<T>, item: T) =>
    col.render ? col.render(item) : ((item[col.key] as React.ReactNode) ?? "");

  // Row-level interaction props. `onRowClick` drives all three inputs
  // (mouse, keyboard, ARIA). Shared between the desktop `<tr>` and the
  // mobile card so both layouts offer the same affordance.
  const rowInteractionProps = (item: T) =>
    onRowClick
      ? {
          role: "button" as const,
          tabIndex: 0,
          onClick: () => onRowClick(item),
          onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onRowClick(item);
            }
          },
          // Hand cursor + visible focus ring so the affordance is
          // discoverable without hover tooling. `cursor-pointer` is
          // deliberately additive to the existing hover:bg-muted/50.
          className: cn(
            "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          ),
        }
      : {};

  // Cell click-guard — absorbs clicks inside columns flagged
  // `stopRowNavigation` so the row-level handler doesn't also fire
  // when the operator hits an action button. Keyboard events from
  // focusable children (buttons, links) don't bubble to the row by
  // default, so mouse is the only vector we need to gate.
  const cellClickGuard = (col: DataTableColumn<T>) =>
    onRowClick && col.stopRowNavigation
      ? { onClick: (e: React.MouseEvent) => e.stopPropagation() }
      : {};

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
                : data.map((item, rowIdx) => {
                    const interaction = rowInteractionProps(item);
                    const isActive = activeRowIndex === rowIdx;
                    return (
                      <tr
                        key={rowIdx}
                        {...interaction}
                        // B2 — when a page-level keyboard nav hook
                        // owns the cursor, expose it to assistive
                        // tech via `aria-selected` and the
                        // `data-active` attribute used by the
                        // theming layer.
                        aria-selected={onRowClick ? isActive : undefined}
                        data-active={isActive || undefined}
                        onMouseEnter={onRowHover ? () => onRowHover(rowIdx) : undefined}
                        className={cn(
                          "border-t border-border transition-colors hover:bg-muted/50",
                          isActive && "bg-teranga-gold/10 ring-2 ring-inset ring-teranga-gold/40",
                          interaction.className,
                        )}
                      >
                        {columns.map((col) => (
                          <td
                            key={col.key}
                            className="px-4 py-3 text-foreground align-middle"
                            {...cellClickGuard(col)}
                          >
                            {renderCellValue(col, item)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
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
              : data.map((item, rowIdx) => {
                  const interaction = rowInteractionProps(item);
                  return (
                    <div
                      key={rowIdx}
                      {...interaction}
                      className={cn("p-4 space-y-1.5", interaction.className)}
                    >
                      <div className="font-medium text-foreground">
                        {renderCellValue(primaryCol, item)}
                      </div>
                      {detailCols.map((col) => (
                        <div
                          key={col.key}
                          className="flex items-center justify-between text-sm"
                          {...cellClickGuard(col)}
                        >
                          <span className="text-muted-foreground">{col.header}</span>
                          <span className="text-foreground text-right max-w-[60%] truncate">
                            {renderCellValue(col, item)}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
        </div>
      )}

      {!loading && data.length === 0 && <EmptyState title={emptyMessage} className="py-8" />}
    </div>
  );
}
DataTable.displayName = "DataTable";

export { DataTable };
