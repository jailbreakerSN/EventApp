"use client";

import { useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { SHORTCUT_DEFINITIONS, formatKeys } from "@/hooks/use-keyboard-shortcuts";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Render a single key token styled as a <kbd> element */
function KeyBadge({ value }: { value: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-md border border-border bg-muted text-foreground font-mono text-xs font-semibold shadow-sm">
      {value}
    </kbd>
  );
}

/** Render a full shortcut: either a single key or a sequence ("g" then "e") */
function ShortcutKeys({ keys }: { keys: string | string[] }) {
  const parts = formatKeys(keys);

  if (parts.length === 1) {
    return <KeyBadge value={parts[0]} />;
  }

  return (
    <span className="flex items-center gap-1">
      {parts.map((k, i) => (
        <span key={i} className="flex items-center gap-1">
          <KeyBadge value={k} />
          {i < parts.length - 1 && (
            <span className="text-muted-foreground text-xs">puis</span>
          )}
        </span>
      ))}
    </span>
  );
}

const CATEGORIES = ["Navigation", "Actions"] as const;

export function KeyboardShortcutsDialog({ open, onClose }: KeyboardShortcutsDialogProps) {
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
      aria-modal="true"
      role="dialog"
      aria-label="Raccourcis clavier"
    >
      {/* Panel */}
      <div className="relative w-full max-w-md bg-card text-card-foreground rounded-2xl shadow-xl border border-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Raccourcis clavier</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-accent motion-safe:transition-colors"
            aria-label="Fermer"
          >
            <X size={16} className="text-muted-foreground" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-6 max-h-[70vh] overflow-y-auto">
          {CATEGORIES.map((category) => {
            const items = SHORTCUT_DEFINITIONS.filter((s) => s.category === category);
            return (
              <section key={category}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  {category === "Navigation" ? "Navigation" : "Actions"}
                </h3>
                <ul className="space-y-2">
                  {items.map((shortcut, idx) => (
                    <li
                      key={idx}
                      className="flex items-center justify-between gap-4 py-1"
                    >
                      <span className="text-sm text-foreground">{shortcut.description}</span>
                      <ShortcutKeys keys={shortcut.keys} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        {/* Footer hint */}
        <div className="px-6 py-3 border-t border-border bg-muted/40">
          <p className="text-xs text-muted-foreground text-center">
            Appuyez sur <KeyBadge value="?" /> n&apos;importe où pour afficher cette aide
          </p>
        </div>
      </div>
    </div>
  );
}
