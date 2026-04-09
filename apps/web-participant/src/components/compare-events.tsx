"use client";

import { useState, createContext, useContext, useCallback } from "react";
import { useRouter } from "next/navigation";
import { GitCompareArrows, X } from "lucide-react";
import { Button } from "@teranga/shared-ui";

interface CompareContextValue {
  selected: Set<string>;
  toggle: (eventId: string) => void;
  isSelected: (eventId: string) => boolean;
  canAdd: boolean;
}

const CompareContext = createContext<CompareContextValue>({
  selected: new Set(),
  toggle: () => {},
  isSelected: () => false,
  canAdd: true,
});

export function useCompare() {
  return useContext(CompareContext);
}

const MAX_COMPARE = 3;

export function CompareProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const router = useRouter();

  const toggle = useCallback((eventId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else if (next.size < MAX_COMPARE) {
        next.add(eventId);
      }
      return next;
    });
  }, []);

  const isSelected = useCallback((eventId: string) => selected.has(eventId), [selected]);

  const canAdd = selected.size < MAX_COMPARE;

  const handleCompare = () => {
    if (selected.size < 2) return;
    const ids = Array.from(selected).join(",");
    router.push(`/events/compare?ids=${ids}`);
  };

  const handleClear = () => {
    setSelected(new Set());
  };

  return (
    <CompareContext.Provider value={{ selected, toggle, isSelected, canAdd }}>
      {children}

      {/* Floating compare bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-in slide-in-from-bottom-4 fade-in duration-200">
          <div className="flex items-center gap-3 rounded-full border bg-card px-5 py-3 shadow-lg">
            <GitCompareArrows className="h-5 w-5 text-teranga-gold" />
            <span className="text-sm font-medium">
              {selected.size} evenement{selected.size > 1 ? "s" : ""} selectionne
              {selected.size > 1 ? "s" : ""}
            </span>
            <Button
              size="sm"
              onClick={handleCompare}
              disabled={selected.size < 2}
              className="rounded-full"
            >
              Comparer
            </Button>
            <button
              onClick={handleClear}
              className="rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Annuler la comparaison"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </CompareContext.Provider>
  );
}
