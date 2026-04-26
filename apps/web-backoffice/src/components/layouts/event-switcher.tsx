"use client";

/**
 * Organizer overhaul — Phase O1.
 *
 * Global event switcher mounted in the topbar. Lets ops-first organizers
 * jump between active events in 1 click instead of the current 3-click
 * sequence (sidebar → /events → click row).
 *
 * Visibility model:
 *  - Always rendered for callers who hold `event:read` (organizer,
 *    co_organizer, super_admin). Venue managers see nothing — they
 *    don't own events.
 *  - When the current path is `/events/{id}/...` the trigger displays
 *    the active event title; otherwise it shows a neutral placeholder
 *    "Choisir un événement".
 *
 * Keyboard:
 *  - ⌘⇧E (Mac) / Ctrl+Shift+E (Windows/Linux) toggles the popover.
 *  - Once open: ↑/↓ to navigate, ↵ to select, Esc to close.
 *  - Type to filter on title (case + accent insensitive).
 *
 * Data:
 *  - Reads from `useEvents()` which already scopes to the caller's
 *    organisation. We request the first 50 rows (the realistic working
 *    set for a Pro organizer); past that, the user reaches for /events.
 *  - Cancelled / completed / archived are filtered out — they are not
 *    actionable destinations for "switch to this event right now".
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { Calendar, ChevronsUpDown, CircleDot, FileText, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEvents } from "@/hooks/use-events";
import { usePermissions } from "@/hooks/use-permissions";
import type { Event as TerangaEvent } from "@teranga/shared-types";
import {
  groupEvents,
  normaliseSearchTerm,
  SWITCHER_GROUP_LABEL as GROUP_LABEL,
  SWITCHER_GROUP_ORDER as GROUP_ORDER,
  type SwitcherGroup,
} from "./event-switcher-utils";

const FALLBACK_LIMIT = 50;

export function EventSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ eventId?: string }>();
  const { can } = usePermissions();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Only fetch when the popover is open OR when we need the title for
  // the trigger (event-scoped path). Avoids a query firing on every
  // organizer page just to hydrate a button label that won't render.
  const eventScoped = useMemo(
    () => Boolean(params?.eventId) || pathname.startsWith("/events/"),
    [params?.eventId, pathname],
  );

  const allowed = can("event:read");
  const { data: eventsResp, isLoading } = useEvents(
    { page: 1, limit: FALLBACK_LIMIT, orderBy: "startDate", orderDir: "asc" },
    { enabled: allowed && (open || eventScoped) },
  );
  const events: readonly TerangaEvent[] = eventsResp?.data ?? [];

  // ─── Trigger label — current event title when on /events/[id]/... ────
  const currentEvent = useMemo<TerangaEvent | null>(() => {
    if (!params?.eventId) return null;
    return events.find((e) => e.id === params.eventId) ?? null;
  }, [events, params?.eventId]);

  // ─── Filter + group ──────────────────────────────────────────────────
  const groups = useMemo<SwitcherGroup[]>(() => {
    const grouped = groupEvents(events);
    if (!query.trim()) return grouped;
    const needle = normaliseSearchTerm(query);
    return grouped
      .map((g) => ({
        key: g.key,
        events: g.events.filter((e) => normaliseSearchTerm(e.title ?? "").includes(needle)),
      }))
      .filter((g) => g.events.length > 0);
  }, [events, query]);

  // Flat list for keyboard navigation
  const flat = useMemo(() => groups.flatMap((g) => g.events), [groups]);

  // ─── Keyboard shortcut: ⌘⇧E / Ctrl+Shift+E ────────────────────────────
  useEffect(() => {
    if (!allowed) return;
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && key === "e") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [allowed]);

  // ─── Focus management ────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      // RAF so the popover is mounted before we attempt to focus.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    setQuery("");
    setActiveIndex(0);
  }, [open]);

  // Reset active index when filter results shrink
  useEffect(() => {
    if (activeIndex >= flat.length) setActiveIndex(0);
  }, [flat.length, activeIndex]);

  // Click-outside dismissal
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        listRef.current &&
        !listRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Escape to close (when popover open). Sidebar's Escape handler also
  // listens, but it only closes the mobile drawer when it's open — no
  // collision with the switcher.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (!allowed) return null;

  const handleNavigate = (eventId: string) => {
    setOpen(false);
    router.push(`/events/${eventId}`);
  };

  const handleListKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length));
    } else if (e.key === "Enter" && flat.length > 0) {
      e.preventDefault();
      const target = flat[activeIndex];
      if (target) handleNavigate(target.id);
    }
  };

  const triggerLabel = currentEvent?.title ?? "Choisir un événement";

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={
          currentEvent
            ? `Événement courant : ${currentEvent.title}. Changer d'événement.`
            : "Choisir un événement"
        }
        title="Changer d'événement (⌘⇧E)"
        className={cn(
          "hidden md:inline-flex items-center gap-2 max-w-[220px] px-2.5 py-1.5 rounded-lg border border-border bg-background text-sm text-foreground hover:bg-accent motion-safe:transition-colors",
          open && "ring-2 ring-primary/30",
        )}
      >
        <Calendar size={14} aria-hidden="true" className="text-muted-foreground shrink-0" />
        <span className="flex-1 truncate text-left text-xs font-medium">{triggerLabel}</span>
        <ChevronsUpDown size={12} aria-hidden="true" className="text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div
          ref={listRef}
          className="absolute z-50 mt-2 left-0 w-[320px] sm:w-[380px] rounded-lg border border-border bg-background shadow-lg"
          role="dialog"
          aria-label="Sélecteur d'événement"
          onKeyDown={handleListKeyDown}
          tabIndex={-1}
        >
          {/* Search */}
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            <Search size={14} className="text-muted-foreground shrink-0" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              placeholder="Rechercher un événement…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label="Rechercher un événement"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Effacer la recherche"
              >
                <X size={13} aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Body */}
          <div className="max-h-[360px] overflow-y-auto py-1">
            {isLoading && (
              <p className="px-3 py-3 text-xs text-muted-foreground">Chargement des événements…</p>
            )}
            {!isLoading && flat.length === 0 && (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                {query
                  ? `Aucun événement ne correspond à « ${query} ».`
                  : "Aucun événement actif. Créez-en un depuis la liste des événements."}
              </p>
            )}
            {!isLoading &&
              groups.map((group) => {
                let runningIndex = 0;
                // Compute the global index offset for this group so each
                // row knows its place in the flat keyboard-nav list.
                const offset = groups
                  .slice(0, GROUP_ORDER.indexOf(group.key))
                  // Defensive: indexOf can return -1 if a future group key
                  // is added without updating GROUP_ORDER. Falls back to
                  // counting only earlier groups present in `groups`.
                  .reduce((n, g) => n + g.events.length, 0);
                runningIndex = offset;
                return (
                  <div key={group.key} className="py-1">
                    <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1">
                      {GROUP_LABEL[group.key]}
                    </p>
                    <ul role="listbox" aria-label={GROUP_LABEL[group.key]}>
                      {group.events.map((ev) => {
                        const idx = runningIndex++;
                        const active = idx === activeIndex;
                        const isCurrent = ev.id === params?.eventId;
                        return (
                          <li key={ev.id} role="option" aria-selected={active}>
                            <button
                              type="button"
                              onClick={() => handleNavigate(ev.id)}
                              onMouseEnter={() => setActiveIndex(idx)}
                              className={cn(
                                "w-full flex items-center gap-2 px-3 py-2 text-left text-sm motion-safe:transition-colors",
                                active ? "bg-accent" : "hover:bg-accent/60",
                                isCurrent && "font-medium",
                              )}
                            >
                              {group.key === "live" ? (
                                <CircleDot
                                  size={13}
                                  className="text-emerald-500 shrink-0"
                                  aria-label="En direct"
                                />
                              ) : group.key === "drafts" ? (
                                <FileText
                                  size={13}
                                  className="text-muted-foreground shrink-0"
                                  aria-label="Brouillon"
                                />
                              ) : (
                                <Calendar
                                  size={13}
                                  className="text-muted-foreground shrink-0"
                                  aria-hidden="true"
                                />
                              )}
                              <span className="flex-1 truncate">{ev.title}</span>
                              {isCurrent && (
                                <span className="text-[10px] text-primary uppercase tracking-wider shrink-0">
                                  Courant
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
          </div>

          {/* Footer hint */}
          <div className="border-t border-border px-3 py-2 flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="font-mono bg-muted border border-border rounded px-1 py-0.5">⌘⇧E</kbd>
              Ouvrir
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-mono bg-muted border border-border rounded px-1 py-0.5">↵</kbd>
              Aller
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-mono bg-muted border border-border rounded px-1 py-0.5">
                Échap
              </kbd>
              Fermer
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
