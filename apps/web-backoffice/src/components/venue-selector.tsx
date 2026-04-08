"use client";

import { useState, useEffect, useRef } from "react";
import { MapPin, Search, X } from "lucide-react";
import { useVenues } from "@/hooks/use-venues";
import { cn } from "@/lib/utils";

const VENUE_TYPE_LABELS: Record<string, string> = {
  hotel: "H\u00f4tel",
  conference_center: "Centre de conf.",
  cultural_space: "Espace culturel",
  coworking: "Coworking",
  restaurant: "Restaurant",
  outdoor: "Plein air",
  university: "Universit\u00e9",
  sports: "Sports",
  other: "Autre",
};

interface VenueSelectorProps {
  onSelect: (venue: {
    id: string;
    name: string;
    address: { street: string; city: string; country: string };
    venueType: string;
  } | null) => void;
  selectedVenueId?: string | null;
  selectedVenueName?: string | null;
}

export function VenueSelector({ onSelect, selectedVenueId, selectedVenueName }: VenueSelectorProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data } = useVenues({
    q: debouncedSearch || undefined,
    limit: 8,
  });

  const venues = data?.data ?? [];

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSelect = (venue: any) => {
    onSelect({
      id: venue.id,
      name: venue.name,
      address: venue.address ?? { street: "", city: "", country: "SN" },
      venueType: venue.venueType,
    });
    setSearch("");
    setIsOpen(false);
  };

  const handleClear = () => {
    onSelect(null);
    setSearch("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        setFocusedIndex((i) => Math.min(i + 1, venues.length)); // +1 for "manual" option
        e.preventDefault();
        break;
      case "ArrowUp":
        setFocusedIndex((i) => Math.max(i - 1, 0));
        e.preventDefault();
        break;
      case "Enter":
        if (focusedIndex === venues.length) {
          // "Saisie manuelle" option
          onSelect(null);
          setIsOpen(false);
        } else if (focusedIndex >= 0 && focusedIndex < venues.length) {
          handleSelect(venues[focusedIndex]);
        }
        e.preventDefault();
        break;
      case "Escape":
        setIsOpen(false);
        e.preventDefault();
        break;
    }
  };

  if (selectedVenueId) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-primary/30 bg-primary/5">
        <MapPin size={16} className="text-primary shrink-0" />
        <span className="text-sm text-foreground flex-1">{selectedVenueName ?? "Lieu s\u00e9lectionn\u00e9"}</span>
        <button
          type="button"
          onClick={handleClear}
          className="p-1 rounded hover:bg-background/50"
          aria-label="Retirer le lieu s\u00e9lectionn\u00e9"
        >
          <X size={14} className="text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setIsOpen(true);
            setFocusedIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Rechercher un lieu r\u00e9f\u00e9renc\u00e9 sur Teranga..."
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
      </div>

      {isOpen && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 w-full bg-background border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto"
        >
          {venues.length === 0 && search.length > 0 && (
            <li className="px-4 py-3 text-sm text-muted-foreground text-center">
              Aucun lieu trouv\u00e9
            </li>
          )}

          {venues.map((venue: any, i: number) => (
            <li
              key={venue.id}
              role="option"
              aria-selected={focusedIndex === i}
              onClick={() => handleSelect(venue)}
              className={cn(
                "px-4 py-2.5 cursor-pointer text-sm",
                focusedIndex === i
                  ? "bg-primary/10 text-foreground"
                  : "hover:bg-muted/50 text-foreground"
              )}
            >
              <div className="font-medium">{venue.name}</div>
              <div className="text-xs text-muted-foreground">
                {VENUE_TYPE_LABELS[venue.venueType] ?? venue.venueType}
                {venue.address?.city && ` \u2014 ${venue.address.city}`}
              </div>
            </li>
          ))}

          {/* Manual entry option */}
          <li
            role="option"
            aria-selected={focusedIndex === venues.length}
            onClick={() => { onSelect(null); setIsOpen(false); }}
            className={cn(
              "px-4 py-2.5 cursor-pointer text-sm border-t border-border",
              focusedIndex === venues.length
                ? "bg-primary/10 text-foreground"
                : "hover:bg-muted/50 text-muted-foreground"
            )}
          >
            Saisie manuelle (lieu non r\u00e9f\u00e9renc\u00e9)
          </li>
        </ul>
      )}
    </div>
  );
}
