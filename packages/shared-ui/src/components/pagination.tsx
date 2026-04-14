"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";
import { DEFAULT_UI_LOCALE_FR, type PaginationLabels } from "../lib/i18n";

export interface PaginationProps extends React.HTMLAttributes<HTMLElement> {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /**
   * Localised labels. Pass a partial object to override individual keys;
   * unspecified keys fall back to French defaults (DEFAULT_UI_LOCALE_FR).
   */
  labels?: Partial<PaginationLabels>;
}

function getPageNumbers(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "ellipsis")[] = [1];

  if (current > 3) {
    pages.push("ellipsis");
  }

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) {
    pages.push("ellipsis");
  }

  pages.push(total);

  return pages;
}

function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  className,
  labels,
  ...props
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = getPageNumbers(currentPage, totalPages);
  const l = { ...DEFAULT_UI_LOCALE_FR.pagination, ...labels };

  const buttonBase =
    "inline-flex items-center justify-center h-9 min-w-9 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

  return (
    <nav
      role="navigation"
      aria-label={l.navigation}
      className={cn("flex items-center justify-center gap-1", className)}
      {...props}
    >
      <button
        type="button"
        className={cn(buttonBase, "px-2 hover:bg-accent hover:text-accent-foreground")}
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        aria-label={l.previous}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {pages.map((page, idx) =>
        page === "ellipsis" ? (
          <span
            key={`ellipsis-${idx}`}
            className="inline-flex h-9 min-w-9 items-center justify-center text-sm text-muted-foreground"
          >
            ...
          </span>
        ) : (
          <button
            key={page}
            type="button"
            className={cn(
              buttonBase,
              page === currentPage
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent hover:text-accent-foreground",
            )}
            onClick={() => onPageChange(page)}
            aria-current={page === currentPage ? "page" : undefined}
            aria-label={l.page(page)}
          >
            {page}
          </button>
        ),
      )}

      <button
        type="button"
        className={cn(buttonBase, "px-2 hover:bg-accent hover:text-accent-foreground")}
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        aria-label={l.next}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}
Pagination.displayName = "Pagination";

export { Pagination };
