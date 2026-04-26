"use client";

import * as React from "react";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import { cn } from "../lib/utils";
import { Skeleton } from "./skeleton";
import { EmptyState } from "./empty-state";

export type SortDirection = "asc" | "desc";

export interface DataTableSortState {
  field: string;
  dir: SortDirection;
}

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
  /**
   * V2 — sortable header. When true, the header becomes a button that
   * cycles through none → asc → desc → none on click. Pair with the
   * `sort` and `onToggleSort` props on DataTable. The sort key sent to
   * the parent is `sortField ?? key`. Doctrine: every column whose
   * underlying field is indexable on the server SHOULD be sortable.
   */
  sortable?: boolean;
  /** Server-side sort key. Defaults to `key`. */
  sortField?: string;
  /** V2 — text alignment. Defaults to "left". */
  align?: "left" | "right" | "center";
  /** V2 — sticky on desktop scroll. Use sparingly (1 col left, 1 col right max). */
  sticky?: "left" | "right";
  /** V2 — accessible name for icon-only columns. */
  ariaLabel?: string;
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
  /**
   * V2 — controlled sort state. Pair with `onToggleSort`. The doctrine
   * mandates server-side sort for admin tables; pass the value from
   * `useTableState` and route the toggle back to it.
   */
  sort?: DataTableSortState | null;
  onToggleSort?: (sortField: string) => void;
  /**
   * V2 — sticky thead on vertical scroll. Default: true. Disable for
   * tables embedded inside a card with its own scroll context.
   */
  stickyHeader?: boolean;
  /**
   * V2 — row density. "comfortable" matches v1 spacing; "compact" trims
   * to py-2 px-3 + text-sm for power-user views.
   */
  density?: "compact" | "comfortable";
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
  sort,
  onToggleSort,
  stickyHeader = true,
  density = "comfortable",
  ...props
}: DataTableProps<T>) {
  const padCell = density === "compact" ? "px-3 py-2" : "px-4 py-3";
  const fontSize = density === "compact" ? "text-sm" : "text-sm";
  const headerHeight = density === "compact" ? "h-9" : "h-10";

  const alignClass = (col: DataTableColumn<T>): string =>
    col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left";

  const stickyCellClass = (col: DataTableColumn<T>): string =>
    col.sticky === "left"
      ? "sticky left-0 z-[1] bg-card shadow-[1px_0_0_0_var(--border)]"
      : col.sticky === "right"
        ? "sticky right-0 z-[1] bg-card shadow-[-1px_0_0_0_var(--border)]"
        : "";

  const renderHeaderContent = (col: DataTableColumn<T>): React.ReactNode => {
    if (!col.sortable || !onToggleSort) return col.header;
    const sortField = col.sortField ?? col.key;
    const isActive = sort?.field === sortField;
    const dir = isActive ? sort.dir : null;
    const ariaLabel =
      typeof col.header === "string"
        ? `Trier par ${col.header}${dir === "asc" ? " (croissant)" : dir === "desc" ? " (décroissant)" : ""}`
        : col.ariaLabel ?? "Trier la colonne";

    const Icon = dir === "asc" ? ChevronUp : dir === "desc" ? ChevronDown : ChevronsUpDown;

    return (
      <button
        type="button"
        onClick={() => onToggleSort(sortField)}
        aria-label={ariaLabel}
        className={cn(
          "inline-flex items-center gap-1.5 font-medium hover:text-foreground transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
          isActive && "text-foreground",
        )}
      >
        <span>{col.header}</span>
        <Icon
          className={cn("h-3.5 w-3.5 shrink-0", isActive ? "opacity-100" : "opacity-40")}
          aria-hidden="true"
        />
      </button>
    );
  };

  const ariaSortValue = (col: DataTableColumn<T>): "ascending" | "descending" | "none" | undefined => {
    if (!col.sortable) return undefined;
    const sortField = col.sortField ?? col.key;
    if (sort?.field !== sortField) return "none";
    return sort.dir === "asc" ? "ascending" : "descending";
  };
  const primaryCol = columns.find((c) => c.primary) ?? columns[0];
  const detailCols = responsiveCards
    ? columns.filter((c) => c !== primaryCol && !c.hideOnMobile)
    : columns;

  const renderCellValue = (col: DataTableColumn<T>, item: T) =>
    col.render ? col.render(item) : ((item[col.key] as React.ReactNode) ?? "");

  // Row-level interaction props. `onRowClick` drives all three inputs
  // (mouse, keyboard, ARIA). Shared between the desktop `<tr>` and the
  // mobile card so both layouts offer the same affordance.
  //
  // We deliberately do NOT set `role="button"` on the row, even when
  // it's clickable. Two reasons:
  //   1. `aria-selected` (set below for keyboard cursor tracking) is
  //      legal on the native `<tr>` role but NOT on `role="button"` —
  //      axe `aria-allowed-attr` flags critical otherwise.
  //   2. Action columns (`stopRowNavigation: true`) typically contain
  //      buttons or links; nesting interactive controls inside a
  //      `role="button"` row trips axe `nested-interactive` (serious).
  // Native <tr> + tabIndex + onClick/onKeyDown still gives keyboard +
  // mouse interactivity. Each row should also expose a primary action
  // (link or button) inside a cell as the AT-discoverable entry point.
  const rowInteractionProps = (item: T) =>
    onRowClick
      ? {
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
          <thead
            className={cn(
              "bg-muted/50",
              stickyHeader && "sticky top-0 z-[2]",
            )}
          >
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={ariaSortValue(col)}
                  aria-label={typeof col.header === "string" ? undefined : col.ariaLabel}
                  className={cn(
                    headerHeight,
                    "px-4 align-middle font-medium text-muted-foreground whitespace-nowrap",
                    alignClass(col),
                    stickyCellClass(col),
                  )}
                >
                  {renderHeaderContent(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={fontSize}>
            {loading
              ? Array.from({ length: 5 }).map((_, rowIdx) => (
                  <tr key={rowIdx} className="border-t border-border">
                    {columns.map((col) => (
                      <td key={col.key} className={cn(padCell, stickyCellClass(col))}>
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
                            className={cn(
                              padCell,
                              "text-foreground align-middle",
                              alignClass(col),
                              stickyCellClass(col),
                            )}
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
