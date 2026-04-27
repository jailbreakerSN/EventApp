"use client";

/**
 * Organizer overhaul — Phase O5 (W4 doctrine top-up).
 *
 * Browser for the seeded comms-template library. Category strip +
 * accent-folded text search + card grid with one card per template,
 * each card showing title preview, body preview, suggested channels,
 * and a "Utiliser ce modèle" CTA that fires the `onPick` callback.
 *
 * The composer uses this picker through a callback rather than a
 * shared store — keeps the library component reusable in other
 * contexts (e.g. a future template-management admin page).
 *
 * Doctrine compliance (admin-table archetype, scaled-down):
 *   - Search is debounced (300 ms) and persisted in the URL via nuqs
 *     under the `library` namespace. A Slack link to
 *     `/communications?library.q=rappel&library.cat=reminder` lands
 *     the recipient on the same filtered grid.
 *   - Filter (category) is removable as a chip-strip; the existing
 *     pre-doctrine UX is preserved.
 *   - Sort is "not applicable" — order in `SEED_COMMS_TEMPLATES` is
 *     editorial (most-used first within category). Documented per the
 *     doctrine "explicit not-applicable allowed" clause.
 *   - Pagination is "not applicable" — the catalogue is a static
 *     ~12-template seed; one fetch returns the complete set.
 *   - Empty state distinguishes "category empty server-side" from
 *     "search returned nothing in the visible category".
 *   - Search runs in-memory because the dataset is bounded and
 *     complete (one fetch, all rows). No paginated post-filter
 *     regression because pagination doesn't exist here.
 */

import { useEffect, useMemo, useState } from "react";
import { useQueryStates, parseAsString, parseAsStringEnum } from "nuqs";
import {
  Mail,
  Smartphone,
  Bell,
  Sparkles,
  Clock,
  MessageCircle,
  Search,
  X,
} from "lucide-react";
import { Card, CardContent, Skeleton, Input } from "@teranga/shared-ui";
import { cn } from "@/lib/utils";
import { useCommsTemplates } from "@/hooks/use-comms-templates";
import {
  normalizeFr,
  type CommsTemplate,
  type CommsTemplateCategory,
  type CommunicationChannel,
} from "@teranga/shared-types";

const CATEGORY_TABS: ReadonlyArray<{ id: "all" | CommsTemplateCategory; label: string }> = [
  { id: "all", label: "Tous" },
  { id: "reminder", label: "Rappels" },
  { id: "confirmation", label: "Confirmations" },
  { id: "lifecycle", label: "Cycle de vie" },
  { id: "reengagement", label: "Réengagement" },
];

const CATEGORY_VALUES = CATEGORY_TABS.map((t) => t.id) as ["all", ...CommsTemplateCategory[]];

const CHANNEL_ICON: Record<CommunicationChannel, typeof Mail> = {
  email: Mail,
  sms: Smartphone,
  push: Bell,
  whatsapp: MessageCircle,
  in_app: Bell,
};

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Match a template against an accent-folded query token. We index the
 * concatenation of `label + description + title + body` because all four
 * fields are user-relevant — operators search by the visible label
 * ("Rappel J-7"), by the use-case description, AND by remembered
 * snippets of the body copy. `category` is excluded because the
 * category-tab filter is the canonical way to narrow by category.
 */
function templateMatchesQuery(template: CommsTemplate, needle: string): boolean {
  if (!needle) return true;
  const haystack = normalizeFr(
    `${template.label} ${template.description} ${template.title} ${template.body}`,
  );
  return haystack.includes(needle);
}

export interface CommsTemplateLibraryProps {
  onPick?: (template: CommsTemplate) => void;
  className?: string;
}

export function CommsTemplateLibrary({ onPick, className }: CommsTemplateLibraryProps) {
  // nuqs-backed URL state, namespaced under `library` so a deep link
  // to /communications?library.cat=reminder&library.q=rappel survives
  // refresh and is shareable on Slack — the doctrine MUST.
  const [{ q, cat }, setLibrary] = useQueryStates(
    {
      q: parseAsString.withDefault(""),
      cat: parseAsStringEnum(CATEGORY_VALUES).withDefault("all"),
    },
    { urlKeys: { q: "library.q", cat: "library.cat" } },
  );

  // Local q mirror so typing is responsive; the URL only updates after
  // the debounce. Without this, every keystroke writes to the URL
  // (Next.js router push) which is both noisy and slow.
  const [qLocal, setQLocal] = useState(q);
  useEffect(() => setQLocal(q), [q]);
  useEffect(() => {
    if (qLocal === q) return;
    const handle = setTimeout(() => {
      void setLibrary({ q: qLocal || null });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [qLocal, q, setLibrary]);

  const queryCategory = cat === "all" ? undefined : cat;
  const { data: templates, isLoading } = useCommsTemplates(queryCategory);

  const needle = useMemo(() => normalizeFr(q.trim()), [q]);
  const visible = useMemo(() => {
    const all = templates ?? [];
    if (!needle) return all;
    return all.filter((t) => templateMatchesQuery(t, needle));
  }, [templates, needle]);

  const isCategoryEmpty = !isLoading && (templates ?? []).length === 0;
  const isSearchEmpty = !isLoading && (templates ?? []).length > 0 && visible.length === 0;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Search input — debounced 300 ms, accent-folded server-side
          mirroring the participant /events surface. */}
      <div className="relative max-w-md">
        <Search
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none"
          aria-hidden="true"
        />
        <Input
          type="search"
          role="searchbox"
          value={qLocal}
          onChange={(e) => setQLocal(e.target.value)}
          placeholder="Rechercher dans les modèles..."
          className="pl-9 pr-9"
          aria-label="Rechercher dans la bibliothèque de modèles"
        />
        {qLocal && (
          <button
            type="button"
            onClick={() => setQLocal("")}
            aria-label="Effacer la recherche"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground motion-safe:transition-colors"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Catégories de templates">
        {CATEGORY_TABS.map((tab) => {
          const active = tab.id === cat;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => void setLibrary({ cat: tab.id === "all" ? null : tab.id })}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border motion-safe:transition-colors",
                active
                  ? "border-teranga-gold bg-teranga-gold/10 text-teranga-gold"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-2">
                <Skeleton variant="text" className="h-3 w-1/3" />
                <Skeleton variant="text" className="h-5 w-3/4" />
                <Skeleton variant="text" className="h-3 w-full" />
                <Skeleton variant="text" className="h-3 w-5/6" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty — category genuinely has no templates server-side. */}
      {isCategoryEmpty && (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Aucun template dans cette catégorie pour le moment.
          </CardContent>
        </Card>
      )}

      {/* Empty — there ARE templates in this category but none match q. */}
      {isSearchEmpty && (
        <Card className="border-dashed">
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Aucun modèle ne correspond à&nbsp;
              <span className="font-medium text-foreground">«&nbsp;{q}&nbsp;»</span>
              {cat !== "all" && " dans cette catégorie"}.
            </p>
            <button
              type="button"
              onClick={() => void setLibrary({ q: null, cat: null })}
              className="text-sm font-medium text-teranga-gold hover:underline"
            >
              Réinitialiser les filtres
            </button>
          </CardContent>
        </Card>
      )}

      {!isLoading && visible.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((template) => (
            <TemplateCard key={template.id} template={template} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  onPick,
}: {
  template: CommsTemplate;
  onPick?: (template: CommsTemplate) => void;
}) {
  return (
    <Card className="hover:border-teranga-gold/40 motion-safe:transition-colors">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {template.category}
          </span>
          {template.timing && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {template.timing}
            </span>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{template.label}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{template.description}</p>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-foreground line-clamp-2">{template.title}</p>
          <p className="text-[11px] text-muted-foreground line-clamp-3">{template.body}</p>
        </div>
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1.5">
            {template.defaultChannels.map((ch) => {
              const Icon = CHANNEL_ICON[ch];
              return (
                <span
                  key={ch}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground"
                  title={ch}
                >
                  <Icon className="h-3 w-3" aria-hidden="true" />
                </span>
              );
            })}
          </div>
          {onPick && (
            <button
              type="button"
              onClick={() => onPick(template)}
              className="inline-flex items-center gap-1 text-xs font-medium text-teranga-gold hover:underline"
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              Utiliser ce modèle
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
