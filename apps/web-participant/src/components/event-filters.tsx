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

const DATE_OPTIONS = [
  { value: "", label: "Toutes les dates" },
  { value: "today", label: "Aujourd'hui" },
  { value: "this_week", label: "Cette semaine" },
  { value: "this_month", label: "Ce mois" },
  { value: "next_month", label: "Mois prochain" },
];

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

const PRICES = [
  { value: "", label: "Tous les prix" },
  { value: "free", label: "Gratuit" },
  { value: "paid", label: "Payant" },
];

// Import for local use + re-export so existing imports from this file still work
import { getDateRange } from "@/lib/date-utils";
export { getDateRange };

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

  return (
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
        value={searchParams.get("date") ?? ""}
        onChange={(e) => updateFilters("date", e.target.value)}
        aria-label="Filtrer par date"
      >
        {DATE_OPTIONS.map((d) => (
          <option key={d.value} value={d.value}>{d.label}</option>
        ))}
      </Select>

      <Select
        value={searchParams.get("city") ?? ""}
        onChange={(e) => updateFilters("city", e.target.value)}
        aria-label="Filtrer par ville"
      >
        {CITIES.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </Select>

      <Select
        value={searchParams.get("category") ?? ""}
        onChange={(e) => updateFilters("category", e.target.value)}
        aria-label="Filtrer par catégorie"
      >
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </Select>

      <Select
        value={searchParams.get("format") ?? ""}
        onChange={(e) => updateFilters("format", e.target.value)}
        aria-label="Filtrer par format"
      >
        {FORMATS.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </Select>

      <Select
        value={searchParams.get("price") ?? ""}
        onChange={(e) => updateFilters("price", e.target.value)}
        aria-label="Filtrer par prix"
      >
        {PRICES.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
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
  );
}
