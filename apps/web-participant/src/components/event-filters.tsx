"use client";

import * as React from "react";
import type { JSX } from "react";
import { parseAsArrayOf, parseAsString, parseAsStringEnum } from "nuqs";
import { useTranslations } from "next-intl";
import { Search, SlidersHorizontal, ArrowUpDown } from "lucide-react";
import { Input, FiltersBottomSheet } from "@teranga/shared-ui";
import { useTableState } from "@/hooks/use-table-state";
import { getDateRange } from "@/lib/date-utils";

// Re-export so call sites that import getDateRange from this file keep working.
export { getDateRange };

// ─── Catalogues (must match the backend EventCategorySchema / EventFormatSchema) ──

const CITIES = [
  "Dakar",
  "Thiès",
  "Saint-Louis",
  "Mbour",
  "Ziguinchor",
  "Kaolack",
  "Tambacounda",
] as const;

type EventCategory =
  | "conference"
  | "workshop"
  | "concert"
  | "festival"
  | "networking"
  | "sport"
  | "exhibition"
  | "ceremony"
  | "training";

const CATEGORIES: readonly EventCategory[] = [
  "conference",
  "workshop",
  "concert",
  "festival",
  "networking",
  "sport",
  "exhibition",
  "ceremony",
  "training",
] as const;

type EventFormat = "in_person" | "online" | "hybrid";

const FORMATS: readonly EventFormat[] = ["in_person", "online", "hybrid"] as const;

const DATE_CHIPS = ["today", "this_week", "this_weekend", "this_month"] as const;
const PRICE_CHIPS = ["free", "paid"] as const;

// Sort options offered to the user. Backed by Firestore composite indexes
// already declared in firestore.indexes.json. popularity / price /
// proximity sorts require denormalised counters or a Geohash and are
// deferred to a follow-up PR per the data-listing roadmap.
const SORT_OPTIONS = [
  { id: "soonest", field: "startDate", dir: "asc" as const, labelKey: "soonest" },
  { id: "newest", field: "createdAt", dir: "desc" as const, labelKey: "newest" },
  { id: "alphabetical", field: "title", dir: "asc" as const, labelKey: "alphabetical" },
] as const;

const SORTABLE_FIELDS = ["startDate", "createdAt", "title"] as const;

type Filters = {
  category?: string[]; // multi-select via parseAsArrayOf<string>
  format?: EventFormat;
  city?: string;
  date?: (typeof DATE_CHIPS)[number];
  price?: (typeof PRICE_CHIPS)[number];
};

// ─── Component ───────────────────────────────────────────────────────────

export function EventFilters(): JSX.Element {
  const tFilters = useTranslations("events.filters");
  const tCategories = useTranslations("categories");
  const tFormat = useTranslations("format");

  const t = useTableState<Filters>({
    urlNamespace: "",
    // pageSize is omitted: the discovery grid is fixed at 12 server-side
    // (3x4) and we do not expose a page-size selector. The hook's internal
    // default (25) is harmless because nothing on this page reads
    // `t.pageSize`. PR follow-up if we want a "Voir plus / Voir moins"
    // toggle.
    defaults: { sort: { field: "startDate", dir: "asc" } },
    sortableFields: SORTABLE_FIELDS,
    filterParsers: {
      category: parseAsArrayOf(parseAsString),
      format: parseAsStringEnum<EventFormat>([...FORMATS]),
      city: parseAsString,
      date: parseAsStringEnum<(typeof DATE_CHIPS)[number]>([...DATE_CHIPS]),
      price: parseAsStringEnum<(typeof PRICE_CHIPS)[number]>([...PRICE_CHIPS]),
    },
    // Page is a Server Component — URL changes MUST trigger a route refresh
    // so the server re-fetches with the new params. Without shallow:false,
    // the URL would update but the rendered grid would stay stale.
    shallow: false,
  });

  // Date chip → URL has both `date` (the chip key) and `dateFrom/dateTo` (the
  // expanded range the API consumes). Side-effect committed via a parallel
  // setQS hook on the page header (kept for backward compatibility with
  // bookmarked URLs) — for now we encode the side-effect inside the toggle
  // handler, which writes both keys atomically through router.push.
  const setDate = (next: (typeof DATE_CHIPS)[number] | undefined): void => {
    t.setFilter("date", next);
    // Range expansion is computed server-side from the date chip via
    // getDateRange(); the page reads ?date=… and derives dateFrom/dateTo.
    // No extra URL keys needed.
  };

  const togglePrice = (chip: (typeof PRICE_CHIPS)[number]): void => {
    t.setFilter("price", t.filters.price === chip ? undefined : chip);
  };

  const toggleCategory = (cat: EventCategory): void => {
    const current = t.filters.category ?? [];
    const next = current.includes(cat)
      ? current.filter((c) => c !== cat)
      : [...current, cat];
    t.setFilter("category", next.length > 0 ? next : undefined);
  };

  const [sheetOpen, setSheetOpen] = React.useState(false);

  // Active sort = the option whose (field,dir) match the URL state.
  const activeSort =
    SORT_OPTIONS.find((o) => o.field === t.sort?.field && o.dir === t.sort?.dir) ??
    SORT_OPTIONS[0];
  const setSort = (id: (typeof SORT_OPTIONS)[number]["id"]): void => {
    const opt = SORT_OPTIONS.find((o) => o.id === id);
    if (!opt) return;
    // toggleSort cycles asc → desc → none; we want a direct set so the user
    // gets the documented order for each option. Drive setSortUrl through
    // toggleSort by short-circuiting: if the current state matches asc, one
    // toggle reaches desc; otherwise we toggle until the field matches and
    // then set the desired direction.
    if (t.sort?.field !== opt.field) {
      t.toggleSort(opt.field); // none → asc
      if (opt.dir === "desc") t.toggleSort(opt.field); // asc → desc
    } else if (t.sort.dir !== opt.dir) {
      t.toggleSort(opt.field); // asc ↔ desc
    }
  };

  const hasActive = t.q || t.activeFilterCount > 0;

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Search row — sticky on mobile so the bar stays available while the
          user scrolls through the result grid. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="relative flex-1 sm:max-w-xl">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none"
            aria-hidden="true"
          />
          <Input
            type="search"
            role="searchbox"
            placeholder={tFilters("searchPlaceholder")}
            value={t.q}
            onChange={(e) => t.setQ(e.target.value)}
            className="pl-10"
            aria-label={tFilters("searchPlaceholder")}
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Mobile filters trigger — opens the bottom sheet. Hidden on md+
              where the inline filters render below. */}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="md:hidden inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-sm font-medium hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={tFilters("openFilters")}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            {tFilters("filters")}
            {t.activeFilterCount > 0 ? (
              <span className="rounded-full bg-primary text-primary-foreground px-1.5 text-xs font-semibold leading-5">
                {t.activeFilterCount}
              </span>
            ) : null}
          </button>

          {/* Sort menu */}
          <SortMenu activeId={activeSort.id} onChange={setSort} />

          {/* Clear-all */}
          {hasActive ? (
            <button
              type="button"
              onClick={t.reset}
              className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              {tFilters("clear")}
            </button>
          ) : null}
        </div>
      </div>

      {/* Desktop inline filters (hidden on mobile — bottom sheet covers it). */}
      <div className="hidden md:block space-y-3">
        <CategoryChips
          active={t.filters.category ?? []}
          onToggle={toggleCategory}
          tCategories={tCategories}
          ariaLabel={tFilters("filterByCategory")}
        />
        <div className="flex flex-wrap items-center gap-3">
          <CityFormatPickers
            city={t.filters.city ?? ""}
            onCityChange={(v) => t.setFilter("city", v || undefined)}
            format={t.filters.format ?? ""}
            onFormatChange={(v) => t.setFilter("format", (v || undefined) as EventFormat | undefined)}
            tFilters={tFilters}
            tFormat={tFormat}
          />
          <ChipGroup
            label={tFilters("filterByDate")}
            chips={DATE_CHIPS}
            active={t.filters.date}
            onToggle={(c) => setDate(t.filters.date === c ? undefined : c)}
            labelFn={(c) => tFilters(c === "today" ? "today" : c === "this_week" ? "thisWeek" : c === "this_weekend" ? "thisWeekend" : "thisMonth")}
          />
          <ChipGroup
            label={tFilters("filterByPrice")}
            chips={PRICE_CHIPS}
            active={t.filters.price}
            onToggle={togglePrice}
            labelFn={(c) => tFilters(c)}
          />
        </div>
      </div>

      {/* Mobile bottom sheet — same widgets as desktop, slid up from the
          bottom. Live count is the page's current total — pages that mount
          this component inside a server-rendered grid pass the count via a
          prop in a follow-up; for now we use the URL-state activeFilterCount
          as a proxy badge. */}
      <FiltersBottomSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={tFilters("filters")}
        description={
          t.activeFilterCount > 0
            ? tFilters("activeFilterCount", { count: t.activeFilterCount })
            : undefined
        }
        onApply={() => setSheetOpen(false)}
        onClearAll={hasActive ? t.reset : undefined}
      >
        <CategoryChips
          active={t.filters.category ?? []}
          onToggle={toggleCategory}
          tCategories={tCategories}
          ariaLabel={tFilters("filterByCategory")}
        />
        <CityFormatPickers
          city={t.filters.city ?? ""}
          onCityChange={(v) => t.setFilter("city", v || undefined)}
          format={t.filters.format ?? ""}
          onFormatChange={(v) => t.setFilter("format", (v || undefined) as EventFormat | undefined)}
          tFilters={tFilters}
          tFormat={tFormat}
        />
        <ChipGroup
          label={tFilters("filterByDate")}
          chips={DATE_CHIPS}
          active={t.filters.date}
          onToggle={(c) => setDate(t.filters.date === c ? undefined : c)}
          labelFn={(c) => tFilters(c === "today" ? "today" : c === "this_week" ? "thisWeek" : c === "this_weekend" ? "thisWeekend" : "thisMonth")}
        />
        <ChipGroup
          label={tFilters("filterByPrice")}
          chips={PRICE_CHIPS}
          active={t.filters.price}
          onToggle={togglePrice}
          labelFn={(c) => tFilters(c)}
        />
      </FiltersBottomSheet>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function CategoryChips({
  active,
  onToggle,
  tCategories,
  ariaLabel,
}: {
  active: string[];
  onToggle: (cat: EventCategory) => void;
  tCategories: ReturnType<typeof useTranslations>;
  ariaLabel: string;
}): JSX.Element {
  return (
    <div role="group" aria-label={ariaLabel} className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:pb-0 sm:flex-wrap">
      {CATEGORIES.map((cat) => {
        const on = active.includes(cat);
        return (
          <button
            key={cat}
            type="button"
            onClick={() => onToggle(cat)}
            aria-pressed={on}
            className={
              on
                ? "snap-start shrink-0 rounded-full border-2 border-teranga-gold bg-teranga-gold/10 px-3 py-1.5 text-sm font-medium text-teranga-gold-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-teranga-gold focus-visible:ring-offset-2 dark:bg-teranga-gold/20 dark:text-teranga-gold transition-colors"
                : "snap-start shrink-0 rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors"
            }
          >
            {tCategories(cat)}
          </button>
        );
      })}
    </div>
  );
}

function CityFormatPickers({
  city,
  onCityChange,
  format,
  onFormatChange,
  tFilters,
  tFormat,
}: {
  city: string;
  onCityChange: (v: string) => void;
  format: string;
  onFormatChange: (v: string) => void;
  tFilters: ReturnType<typeof useTranslations>;
  tFormat: ReturnType<typeof useTranslations>;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>{tFilters("filterByCity")}</span>
        <select
          value={city}
          onChange={(e) => onCityChange(e.target.value)}
          aria-label={tFilters("filterByCity")}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">{tFilters("allCities")}</option>
          {CITIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>{tFilters("filterByFormat")}</span>
        <select
          value={format}
          onChange={(e) => onFormatChange(e.target.value)}
          aria-label={tFilters("filterByFormat")}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">{tFilters("allFormats")}</option>
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {tFormat(f)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ChipGroup<T extends string>({
  label,
  chips,
  active,
  onToggle,
  labelFn,
}: {
  label: string;
  chips: readonly T[];
  active: T | undefined;
  onToggle: (chip: T) => void;
  labelFn: (chip: T) => string;
}): JSX.Element {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {chips.map((chip) => {
        const on = active === chip;
        return (
          <button
            key={chip}
            type="button"
            onClick={() => onToggle(chip)}
            aria-pressed={on}
            className={
              on
                ? "rounded-full border-2 border-teranga-gold bg-teranga-gold/10 px-3 py-1.5 text-xs font-medium text-teranga-gold-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-teranga-gold focus-visible:ring-offset-2 dark:bg-teranga-gold/20 dark:text-teranga-gold transition-colors"
                : "rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors"
            }
          >
            {labelFn(chip)}
          </button>
        );
      })}
    </div>
  );
}

function SortMenu({
  activeId,
  onChange,
}: {
  activeId: (typeof SORT_OPTIONS)[number]["id"];
  onChange: (id: (typeof SORT_OPTIONS)[number]["id"]) => void;
}): JSX.Element {
  const t = useTranslations("events.filters.sort");
  return (
    <label className="flex items-center gap-2 text-sm">
      <ArrowUpDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{t("label")}</span>
      <select
        value={activeId}
        onChange={(e) => onChange(e.target.value as (typeof SORT_OPTIONS)[number]["id"])}
        aria-label={t("label")}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {t(opt.labelKey)}
          </option>
        ))}
      </select>
    </label>
  );
}
