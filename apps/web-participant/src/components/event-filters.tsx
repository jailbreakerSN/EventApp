"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useEffect, useMemo } from "react";
import { Search, X } from "lucide-react";
import { Input, Select } from "@teranga/shared-ui";
import { useTranslations } from "next-intl";
import { getDateRange } from "@/lib/date-utils";

// Re-export so call sites that import getDateRange from this file keep working.
export { getDateRange };

const CITIES: { value: string; labelKey: "allCities" | null; raw?: string }[] = [
  { value: "", labelKey: "allCities" },
  { value: "Dakar", labelKey: null, raw: "Dakar" },
  { value: "Thiès", labelKey: null, raw: "Thiès" },
  { value: "Saint-Louis", labelKey: null, raw: "Saint-Louis" },
  { value: "Mbour", labelKey: null, raw: "Mbour" },
  { value: "Ziguinchor", labelKey: null, raw: "Ziguinchor" },
  { value: "Kaolack", labelKey: null, raw: "Kaolack" },
  { value: "Tambacounda", labelKey: null, raw: "Tambacounda" },
];

const CATEGORY_OPTIONS: readonly (
  | { value: ""; kind: "all" }
  | {
      value:
        | "conference"
        | "workshop"
        | "concert"
        | "festival"
        | "networking"
        | "sport"
        | "exhibition"
        | "ceremony"
        | "training";
      kind: "cat";
    }
)[] = [
  { value: "", kind: "all" },
  { value: "conference", kind: "cat" },
  { value: "workshop", kind: "cat" },
  { value: "concert", kind: "cat" },
  { value: "festival", kind: "cat" },
  { value: "networking", kind: "cat" },
  { value: "sport", kind: "cat" },
  { value: "exhibition", kind: "cat" },
  { value: "ceremony", kind: "cat" },
  { value: "training", kind: "cat" },
] as const;

const FORMAT_OPTIONS: readonly (
  | { value: ""; kind: "all" }
  | { value: "in_person" | "online" | "hybrid"; kind: "fmt" }
)[] = [
  { value: "", kind: "all" },
  { value: "in_person", kind: "fmt" },
  { value: "online", kind: "fmt" },
  { value: "hybrid", kind: "fmt" },
] as const;

const DATE_CHIPS: readonly {
  value: "today" | "this_week" | "this_weekend" | "this_month";
  labelKey: "today" | "thisWeek" | "thisWeekend" | "thisMonth";
}[] = [
  { value: "today", labelKey: "today" },
  { value: "this_week", labelKey: "thisWeek" },
  { value: "this_weekend", labelKey: "thisWeekend" },
  { value: "this_month", labelKey: "thisMonth" },
] as const;

const PRICE_CHIPS: readonly { value: "free" | "paid"; labelKey: "free" | "paid" }[] = [
  { value: "free", labelKey: "free" },
  { value: "paid", labelKey: "paid" },
] as const;

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
  const tFilters = useTranslations("events.filters");
  const tCategories = useTranslations("categories");
  const tFormat = useTranslations("format");
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

  const toggleChip = (key: "date" | "price", value: string, current: string) => {
    updateFilters(key, current === value ? "" : value);
  };

  // Labels are memoised so a locale switch re-renders the options without
  // remounting the Select (preserves user's selected value).
  const categoryLabel = useMemo(
    () =>
      CATEGORY_OPTIONS.map((opt) =>
        opt.kind === "all" ? tFilters("allCategories") : tCategories(opt.value),
      ),
    [tFilters, tCategories],
  );
  const formatLabel = useMemo(
    () =>
      FORMAT_OPTIONS.map((opt) =>
        opt.kind === "all" ? tFilters("allFormats") : tFormat(opt.value),
      ),
    [tFilters, tFormat],
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:flex lg:items-center">
        <div className="relative sm:col-span-2 lg:flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={tFilters("searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-10"
          />
        </div>

        <Select
          value={searchParams.get("city") ?? ""}
          onChange={(e) => updateFilters("city", e.target.value)}
          aria-label={tFilters("filterByCity")}
        >
          {CITIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.labelKey ? tFilters(c.labelKey) : c.raw}
            </option>
          ))}
        </Select>

        <Select
          value={searchParams.get("category") ?? ""}
          onChange={(e) => updateFilters("category", e.target.value)}
          aria-label={tFilters("filterByCategory")}
        >
          {CATEGORY_OPTIONS.map((opt, i) => (
            <option key={opt.value || "all"} value={opt.value}>
              {categoryLabel[i]}
            </option>
          ))}
        </Select>

        <Select
          value={searchParams.get("format") ?? ""}
          onChange={(e) => updateFilters("format", e.target.value)}
          aria-label={tFilters("filterByFormat")}
        >
          {FORMAT_OPTIONS.map((opt, i) => (
            <option key={opt.value || "all"} value={opt.value}>
              {formatLabel[i]}
            </option>
          ))}
        </Select>

        {hasFilters && (
          <button
            onClick={() => router.push("/events")}
            className="inline-flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            aria-label={tFilters("reset")}
          >
            <X className="h-4 w-4" />
            {tFilters("clear")}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
        <div
          role="group"
          aria-label={tFilters("filterByDate")}
          className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0"
        >
          {DATE_CHIPS.map((chip) => (
            <FilterChip
              key={chip.value}
              active={activeDate === chip.value}
              onClick={() => toggleChip("date", chip.value, activeDate)}
            >
              {tFilters(chip.labelKey)}
            </FilterChip>
          ))}
        </div>

        <div
          role="group"
          aria-label={tFilters("filterByPrice")}
          className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0"
        >
          {PRICE_CHIPS.map((chip) => (
            <FilterChip
              key={chip.value}
              active={activePrice === chip.value}
              onClick={() => toggleChip("price", chip.value, activePrice)}
            >
              {tFilters(chip.labelKey)}
            </FilterChip>
          ))}
        </div>
      </div>
    </div>
  );
}
