"use client";

/**
 * Organizer overhaul — Phase O7.
 *
 * Reusable saved-views dropdown driven by `useSavedViews(surfaceKey)`.
 * Each surface (organizer participants, event registrations, etc.)
 * passes a stable `surfaceKey` so the views are namespaced per
 * surface — same shape as the admin's saved-views integration.
 *
 * Visual contract:
 *   - Trigger button shows the active view name (or "Vues" placeholder).
 *   - Dropdown lists views with one-click apply; right-side `×`
 *     deletes a view.
 *   - "Enregistrer la vue actuelle" footer captures the current
 *     querystring under a name supplied via inline `prompt()`.
 *
 * No `Popover` library — pure absolute-positioned panel + click-outside
 * handler, mirroring the EventSwitcher pattern from O1.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Bookmark, ChevronDown, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSavedViews, type SavedView } from "@/hooks/use-saved-views";

export interface SavedViewsMenuProps {
  surfaceKey: string;
  className?: string;
}

export function SavedViewsMenu({ surfaceKey, className }: SavedViewsMenuProps) {
  const pathname = usePathname();
  const { views, activeViewId, save, remove, apply } = useSavedViews(surfaceKey);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Click-outside dismissal.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  const triggerLabel = activeView ? activeView.name : "Vues";

  const handleSave = () => {
    const name = window.prompt("Nom de la vue :")?.trim();
    if (!name) return;
    save(name);
    setOpen(false);
  };

  const handleApply = (view: SavedView) => {
    apply(view, pathname);
    setOpen(false);
  };

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent motion-safe:transition-colors",
          activeView && "border-primary/40 bg-primary/5 text-primary",
        )}
      >
        <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
        {triggerLabel}
        <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          className="absolute z-50 mt-2 right-0 w-[280px] rounded-lg border border-border bg-background shadow-lg"
        >
          <div className="max-h-[280px] overflow-y-auto py-1">
            {views.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                Aucune vue enregistrée. Configurez vos filtres puis utilisez « Enregistrer ».
              </p>
            ) : (
              <ul>
                {views.map((view) => {
                  const active = view.id === activeViewId;
                  return (
                    <li key={view.id} className="flex items-center group">
                      <button
                        type="button"
                        onClick={() => handleApply(view)}
                        className={cn(
                          "flex-1 px-3 py-2 text-left text-sm motion-safe:transition-colors",
                          active ? "bg-accent font-medium" : "hover:bg-accent/60",
                        )}
                      >
                        {view.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(view.id)}
                        aria-label={`Supprimer la vue ${view.name}`}
                        className="invisible group-hover:visible px-2 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="border-t border-border">
            <button
              type="button"
              onClick={handleSave}
              className="w-full flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-primary hover:bg-accent/60"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Enregistrer la vue actuelle
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
