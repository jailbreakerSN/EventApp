"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useEffect } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@teranga/shared-ui";

const CATEGORIES = [
  { value: "", label: "Toutes" },
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
  { value: "", label: "Tous" },
  { value: "in_person", label: "Présentiel" },
  { value: "online", label: "En ligne" },
  { value: "hybrid", label: "Hybride" },
];

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

  const hasFilters = searchParams.has("q") || searchParams.has("category") || searchParams.has("format");

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Rechercher un événement..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="pl-10"
        />
      </div>

      <select
        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        value={searchParams.get("category") ?? ""}
        onChange={(e) => updateFilters("category", e.target.value)}
        aria-label="Filtrer par catégorie"
      >
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>

      <select
        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        value={searchParams.get("format") ?? ""}
        onChange={(e) => updateFilters("format", e.target.value)}
        aria-label="Filtrer par format"
      >
        {FORMATS.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>

      {hasFilters && (
        <button
          onClick={() => router.push("/events")}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          aria-label="Réinitialiser les filtres"
        >
          <X className="h-4 w-4" />
          Effacer
        </button>
      )}
    </div>
  );
}
