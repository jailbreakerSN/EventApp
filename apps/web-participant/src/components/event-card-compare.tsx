"use client";

import { useCompare } from "@/components/compare-events";
import { GitCompareArrows } from "lucide-react";

interface CompareCheckboxProps {
  eventId: string;
}

export function CompareCheckbox({ eventId }: CompareCheckboxProps) {
  const { toggle, isSelected, canAdd } = useCompare();
  const checked = isSelected(eventId);
  const disabled = !checked && !canAdd;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) toggle(eventId);
      }}
      disabled={disabled}
      className={`absolute right-3 top-3 z-10 flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium transition-all ${
        checked
          ? "bg-teranga-gold text-white shadow-md"
          : disabled
            ? "bg-background/70 text-muted-foreground/50 cursor-not-allowed backdrop-blur-sm"
            : "bg-background/70 text-muted-foreground hover:bg-background hover:text-foreground backdrop-blur-sm"
      }`}
      aria-label={checked ? "Retirer de la comparaison" : "Ajouter a la comparaison"}
      aria-pressed={checked}
    >
      <GitCompareArrows className="h-3 w-3" />
      {checked ? "Compare" : "Comparer"}
    </button>
  );
}
