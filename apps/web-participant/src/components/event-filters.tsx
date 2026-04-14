"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useEffect } from "react";
import { Search, X } from "lucide-react";
import { Input, Select } from "@teranga/shared-ui";

const CATEGORIES = [
  { value: "", label: "Toutes les catégories" },
  { value: "conference", label: "Conférence" },
  { value: "workshop", label: "Atelier" },
  { value: "concert", label: "Concert" },
  { value: "festival", label: "Festival" },
  { value: "networking", label: "Networking" },
  { value: "sport", label: "Sport" },
  { value: "exhibition", label: "Exposition" },
  { value: "ceremony", label: "Cérémonie" },
  { value: "training", label: "Formation" },
];

const FORMATS = [
  { value: "", label: "Tous les formats" },
  { value: "in_person", label: "Présentiel" },
  { value: "online", label: "En ligne" },
  { value: "hybrid", label: "Hybride" },
];

// Date buckets — ui-ux-pro-max rule 12 (discovery chips).
// Chip row replaces the Select for date; 4 discovery-first buckets.
const DATE_CHIPS = [
  { value: "today", label: "Aujourd'hui" },
  { value: "this_week", label: "Cette semaine" },
  { value: "this_weekend", label: "Ce weekend" },
  { value: "this_month", label: "Ce mois" },
] as const;

const CITIES = [
  { value: "", label: "Toutes les villes" },
  { value: "Dakar", label: "Dakar" },
  { value: "Thiès", label: "Thiès" },
  { value: "Saint-Louis", label: "Saint-Louis" },
  { value: "Mbour", label: "Mbour" },
  { value: "Ziguinchor", label: "Ziguinchor" },
  { value: "Kaolack", label: "Kaolack" },
  { value: "Tambacounda", label: "Tambacounda" },
];

// Price buckets — only the free/paid split is plumbed through the
// backend today. When the API gains priceMin/priceMax filters, swap
// this to the 4-bucket variant (Gratuit / < 10 000 XOF / 10–50 k / > 50 k).
const PRICE_CHIPS = [
  { value: "free", label: "Gratuit" },
  { value: "paid", label: "Payant" },
] as const;

// Import for local use + re-export so existing imports from this file still work
import { getDateRange } from "@/lib/date-utils";
export { getDateRange };

/**
 * Chip button — a Badge-style filter pill.
 * aria-pressed announces selection state to assistive tech.
 * teranga-gold ring + filled background differentiate the active chip.
 */
function FilterChip({
  active,
  onClick,
  children,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={
        active
          ? "snap-start shrink-0 inline-flex items-center rounded-full border-2 border-teranga-gold bg-teranga-gold/10 px-3 py-1.5 text-sm font-medium text-teranga-gold-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-teranga-gold focus-visible:ring-offset-2 dark:bg-teranga-gold/20 dark:text-teranga-gold transition-colors"
          : "snap-start shrink-0 inline-flex items-center rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors"
      }
    >
      {children}
    </button>
  );
}

export function EventFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get("q") ?? "");

  const updateFilters = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      // When date filter changes, update dateFrom/dateTo params
      if (key === "date") {
        const range = getDateRange(value || undefined);
        if (range.dateFrom) {
          params.set("dateFrom", range.dateFrom);
          params.set("dateTo", range.dateTo!);
        } else {
          params.delete("dateFrom");
          params.delete("dateTo");
        }
      }
      params.delete("page");
      router.push(`/events?${params.toString()}`);
    },
    [router, searchParams],
  );

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      const currentQ = searchParams.get("q") ?? "";
      if (searchInput !== currentQ) {
        updateFilters("q", searchInput);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput, searchParams, updateFilters]);

  const hasFilters =
    searchParams.has("q") ||
    searchParams.has("category") ||
    searchParams.has("format") ||
    searchParams.has("date") ||
    searchParams.has("city") ||
    searchParams.has("price");

  const activeDate = searchParams.get("date") ?? "";
  const activePrice = searchParams.get("price") ?? "";

  /** Toggle a chip — clicking the active chip clears the filter. */
  const toggleChip = (key: "date" | "price", value: string, current: string) => {
    updateFilters(key, current === value ? "" : value);
  };

  return (
    <div className="space-y-3">
      {/* Search + non-discovery selects */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:flex lg:items-center">
        <div className="relative sm:col-span-2 lg:flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher un événement..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-10"
          />
        </div>

        <Select
          value={searchParams.get("city") ?? ""}
          onChange={(e) => updateFilters("city", e.target.value)}
          aria-label="Filtrer par ville"
        >
          {CITIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>

        <Select
          value={searchParams.get("category") ?? ""}
          onChange={(e) => updateFilters("category", e.target.value)}
          aria-label="Filtrer par catégorie"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>

        <Select
          value={searchParams.get("format") ?? ""}
          onChange={(e) => updateFilters("format", e.target.value)}
          aria-label="Filtrer par format"
        >
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>

        {hasFilters && (
          <button
            onClick={() => router.push("/events")}
            className="inline-flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            aria-label="Réinitialiser les filtres"
          >
            <X className="h-4 w-4" />
            Effacer
          </button>
        )}
      </div>

      {/* Discovery chips — date + price */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
        <div
          role="group"
          aria-label="Filtrer par date"
          className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0"
        >
          {DATE_CHIPS.map((chip) => (
            <FilterChip
              key={chip.value}
              active={activeDate === chip.value}
              onClick={() => toggleChip("date", chip.value, activeDate)}
            >
              {chip.label}
            </FilterChip>
          ))}
        </div>

        <div
          role="group"
          aria-label="Filtrer par prix"
          className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0"
        >
          {PRICE_CHIPS.map((chip) => (
            <FilterChip
              key={chip.value}
              active={activePrice === chip.value}
              onClick={() => toggleChip("price", chip.value, activePrice)}
            >
              {chip.label}
            </FilterChip>
          ))}
        </div>
      </div>
    </div>
  );
}
