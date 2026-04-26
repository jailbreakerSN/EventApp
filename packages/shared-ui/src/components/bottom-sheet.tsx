"use client";

import * as React from "react";
import type { JSX } from "react";
import { useCallback, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/utils";

/**
 * Mobile-first bottom sheet — slides up from the bottom on small screens,
 * falls back to a centered modal on `md:` and up. Backed by the native
 * <dialog> element to inherit a real focus trap, ESC dismissal, and the
 * built-in `::backdrop` pseudo-element without an extra library.
 *
 * Usage:
 *
 *   <BottomSheet open={open} onOpenChange={setOpen} title="Filtres">
 *     <BottomSheetBody>…</BottomSheetBody>
 *     <BottomSheetFooter>
 *       <Button onClick={…}>Voir 14 résultats</Button>
 *     </BottomSheetFooter>
 *   </BottomSheet>
 *
 * Doctrine: see `docs/design-system/data-listing.md` § Frontend primitives.
 * The mobile filter pattern uses this primitive via <FiltersBottomSheet>.
 */

interface BottomSheetContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titleId: string;
  descId: string;
}

const BottomSheetContext = React.createContext<BottomSheetContextValue>({
  open: false,
  onOpenChange: () => {},
  titleId: "",
  descId: "",
});

export interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible title rendered in the sticky header. */
  title: React.ReactNode;
  /** Optional subtitle rendered under the title (e.g. "3 filtres actifs"). */
  description?: React.ReactNode;
  /** Override the close button's aria-label. Defaults to French "Fermer". */
  closeLabel?: string;
  /** Sheet body + footer. Wrap the body in <BottomSheetBody> for scrollable
   *  semantics and use <BottomSheetFooter> for the sticky action row. */
  children: React.ReactNode;
  /** Tailwind className overrides applied to the inner wrapper. */
  className?: string;
}

export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  closeLabel = "Fermer",
  children,
  className,
}: BottomSheetProps): JSX.Element {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Native <dialog> open/close — showModal() activates the focus trap, ESC
  // dismissal, and the inert backdrop.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // Backdrop click closes. The native dialog reports the dialog element
  // itself as the click target when the backdrop is clicked (children of
  // the dialog stop propagation), so the equality check is the canonical
  // detection pattern.
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDialogElement>) => {
      if (event.target === dialogRef.current) {
        onOpenChange(false);
      }
    },
    [onOpenChange],
  );

  return (
    <BottomSheetContext.Provider value={{ open, onOpenChange, titleId, descId }}>
      <dialog
        ref={dialogRef}
        onClose={handleClose}
        onClick={handleClick}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          // Reset native <dialog> defaults — no border, no padding, no auto-margin.
          "p-0 m-0 max-w-none w-full bg-transparent backdrop:bg-black/50",
          // Mobile (default): slide-up from bottom, full width, capped height.
          "fixed left-0 right-0 bottom-0 top-auto",
          // Desktop (md+): centered modal, max width.
          "md:left-1/2 md:right-auto md:bottom-auto md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:max-w-md",
        )}
      >
        <div
          className={cn(
            "flex flex-col bg-card text-foreground border border-border shadow-2xl",
            // Mobile: rounded only on top, full width, max 85vh so the user
            // always sees a slice of the underlying page (canonical mobile
            // bottom-sheet metric: never fill more than ~85% of viewport).
            "rounded-t-2xl max-h-[85vh] w-full",
            // Desktop: rounded all corners, centered.
            "md:rounded-2xl md:max-h-[80vh]",
            className,
          )}
        >
          {/* Sticky header */}
          <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4 sticky top-0 bg-card z-10 rounded-t-2xl">
            <div className="flex-1 min-w-0">
              <h2
                id={titleId}
                className="text-base font-semibold leading-tight text-foreground"
              >
                {title}
              </h2>
              {description ? (
                <p id={descId} className="mt-0.5 text-xs text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label={closeLabel}
              className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>

          {children}
        </div>
      </dialog>
    </BottomSheetContext.Provider>
  );
}

export function BottomSheetBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={cn("flex-1 overflow-y-auto px-5 py-4", className)}>
      {children}
    </div>
  );
}

export function BottomSheetFooter({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <footer
      className={cn(
        "flex items-center justify-between gap-3 border-t border-border bg-card px-5 py-3 sticky bottom-0",
        className,
      )}
    >
      {children}
    </footer>
  );
}
