"use client";

import * as React from "react";
import { useEffect, useRef, useCallback, useId } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/utils";

/* ------------------------------------------------------------------ */
/*  Dialog (root)                                                      */
/* ------------------------------------------------------------------ */

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
  const titleId = useId();
  const descId = useId();
  return (
    <DialogContext.Provider value={{ open, onOpenChange, titleId, descId }}>
      {children}
    </DialogContext.Provider>
  );
}

const DialogContext = React.createContext<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titleId: string;
  descId: string;
}>({ open: false, onOpenChange: () => {}, titleId: "", descId: "" });

function useDialogContext() {
  return React.useContext(DialogContext);
}

/* ------------------------------------------------------------------ */
/*  DialogContent                                                      */
/* ------------------------------------------------------------------ */

interface DialogContentProps {
  className?: string;
  children: React.ReactNode;
  /** aria-label for the close button. Defaults to the French "Fermer". */
  closeLabel?: string;
}

function DialogContent({ className, children, closeLabel = "Fermer" }: DialogContentProps) {
  const { open, onOpenChange, titleId, descId } = useDialogContext();
  const dialogRef = useRef<HTMLDialogElement>(null);

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

  // Handle backdrop click
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) {
        onOpenChange(false);
      }
    },
    [onOpenChange],
  );

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      onClick={handleClick}
      className={cn(
        "m-auto max-w-lg w-full rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/50",
        className,
      )}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
    >
      <div className="relative p-6">
        {children}
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          aria-label={closeLabel}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  DialogHeader / Footer / Title / Description                        */
/* ------------------------------------------------------------------ */

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-6", className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useDialogContext();
  return (
    <h2
      id={titleId}
      className={cn("text-lg font-semibold leading-none tracking-tight text-foreground", className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { descId } = useDialogContext();
  return (
    <p
      id={descId}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
