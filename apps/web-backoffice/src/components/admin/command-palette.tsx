"use client";

/**
 * Phase 1 — Command palette (Cmd+K / Ctrl+K).
 *
 * A single keyboard-first entry point that lets an admin:
 *   1. Navigate to any admin page (the full sidebar taxonomy is indexed).
 *   2. Search across the four heavy objects (users, organizations, events,
 *      venues) by name / email / slug. Hits deep-link to the object's
 *      detail page.
 *   3. Trigger a small set of "admin actions" that don't belong to any
 *      single page (e.g. "Rafraîchir les stats plateforme").
 *
 * Design constraints:
 * - Opens globally on ⌘K / Ctrl+K (hooked in admin layout, not here).
 * - Debounced search (250ms) to avoid query flood; cancels in-flight
 *   requests on new input via AbortController.
 * - Result list keyboard-navigable (↑↓ Enter, Esc closes).
 * - Results capped at 5 per section (top-N); encourages specificity
 *   instead of scrolling.
 * - Empty state (no query) shows navigation shortcuts + recent items
 *   (stored in localStorage, Phase 5 wires the real recent-history).
 * - Uses the existing shared-ui <Dialog> so focus trap + a11y are free.
 *
 * The search endpoint `/v1/admin/search?q=...` is a new backend
 * addition this commit pulls in as well (see admin.routes.ts). For
 * now the response shape is `{ users, organizations, events, venues }`
 * with up to 5 hits each.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  Users,
  Building2,
  CalendarDays,
  MapPin,
  Inbox,
  LayoutDashboard,
  Bell,
  ScrollText,
  CreditCard,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { Dialog, DialogContent, Input } from "@teranga/shared-ui";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";

// ─── Types ──────────────────────────────────────────────────────────────────

type SearchHit = {
  id: string;
  label: string;
  sublabel?: string;
};

type SearchResponse = {
  success: boolean;
  data: {
    users: SearchHit[];
    organizations: SearchHit[];
    events: SearchHit[];
    venues: SearchHit[];
  };
};

type PaletteItem = {
  kind: "nav" | "action" | "result";
  section: string;
  label: string;
  sublabel?: string;
  href?: string;
  onSelect?: () => void;
  icon: React.ComponentType<{ className?: string }>;
};

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

// ─── Static nav shortcuts ───────────────────────────────────────────────────
// Not every sidebar entry needs to live here — only the ones people type
// rather than click. Tuned to the most-visited admin pages.

const NAV_SHORTCUTS: PaletteItem[] = [
  { kind: "nav", section: "Navigation", label: "Ma boîte", href: "/admin/inbox", icon: Inbox },
  {
    kind: "nav",
    section: "Navigation",
    label: "Vue d'ensemble",
    href: "/admin/overview",
    icon: LayoutDashboard,
  },
  { kind: "nav", section: "Navigation", label: "Utilisateurs", href: "/admin/users", icon: Users },
  {
    kind: "nav",
    section: "Navigation",
    label: "Organisations",
    href: "/admin/organizations",
    icon: Building2,
  },
  {
    kind: "nav",
    section: "Navigation",
    label: "Événements",
    href: "/admin/events",
    icon: CalendarDays,
  },
  { kind: "nav", section: "Navigation", label: "Lieux", href: "/admin/venues", icon: MapPin },
  { kind: "nav", section: "Navigation", label: "Plans", href: "/admin/plans", icon: CreditCard },
  {
    kind: "nav",
    section: "Navigation",
    label: "Notifications",
    href: "/admin/notifications",
    icon: Bell,
  },
  {
    kind: "nav",
    section: "Navigation",
    label: "Audit log",
    href: "/admin/audit",
    icon: ScrollText,
  },
];

// ─── Component ──────────────────────────────────────────────────────────────

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchResponse["data"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset internal state when the palette (re-)opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits(null);
    setActiveIndex(0);
  }, [open]);

  // Debounced search — 250ms is the sweet spot between responsiveness and
  // avoiding 1 request per keystroke on a shared staging API.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHits(null);
      setLoading(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      api
        .get<SearchResponse>(`/v1/admin/search?q=${encodeURIComponent(trimmed)}`)
        .then((res) => {
          if (ctrl.signal.aborted) return;
          setHits(res.data);
          setActiveIndex(0);
        })
        .catch((err) => {
          // A 404 on the endpoint (server not deployed yet) or an abort is
          // intentionally silent — palette falls back to nav-only.
          if (ctrl.signal.aborted) return;
          if ((err as { status?: number }).status !== 404) {
             
            console.warn("[command-palette] search failed", err);
          }
          setHits(null);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  // Flatten into a single list for keyboard navigation.
  const items = useMemo<PaletteItem[]>(() => {
    if (!hits || query.trim().length < 2) {
      return NAV_SHORTCUTS.filter(
        (it) => !query || it.label.toLowerCase().includes(query.toLowerCase()),
      );
    }
    const out: PaletteItem[] = [];
    if (hits.users.length > 0) {
      for (const u of hits.users) {
        out.push({
          kind: "result",
          section: "Utilisateurs",
          label: u.label,
          sublabel: u.sublabel,
          href: `/admin/users/${u.id}`,
          icon: Users,
        });
      }
    }
    if (hits.organizations.length > 0) {
      for (const o of hits.organizations) {
        out.push({
          kind: "result",
          section: "Organisations",
          label: o.label,
          sublabel: o.sublabel,
          href: `/admin/organizations/${o.id}`,
          icon: Building2,
        });
      }
    }
    if (hits.events.length > 0) {
      for (const e of hits.events) {
        out.push({
          kind: "result",
          section: "Événements",
          label: e.label,
          sublabel: e.sublabel,
          href: `/admin/events/${e.id}`,
          icon: CalendarDays,
        });
      }
    }
    if (hits.venues.length > 0) {
      for (const v of hits.venues) {
        out.push({
          kind: "result",
          section: "Lieux",
          label: v.label,
          sublabel: v.sublabel,
          href: `/admin/venues/${v.id}`,
          icon: MapPin,
        });
      }
    }
    return out;
  }, [hits, query]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const item = items[activeIndex];
        if (!item) return;
        e.preventDefault();
        if (item.href) {
          router.push(item.href);
        } else if (item.onSelect) {
          item.onSelect();
        }
        onClose();
      }
    },
    [items, activeIndex, router, onClose],
  );

  // Group items by section for rendering (keeps flat list for kbd).
  const sections = useMemo(() => {
    const map = new Map<string, Array<{ item: PaletteItem; flatIndex: number }>>();
    items.forEach((item, flatIndex) => {
      const list = map.get(item.section) ?? [];
      list.push({ item, flatIndex });
      map.set(item.section, list);
    });
    return [...map.entries()];
  }, [items]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-xl overflow-hidden p-0"
        aria-label="Palette de commandes admin"
      >
        <div onKeyDown={onKeyDown}>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un user, une org, un event, un lieu…"
              className="border-0 shadow-none focus-visible:ring-0"
              aria-label="Rechercher"
            />
            {loading && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
            )}
          </div>

          <div className="max-h-80 overflow-y-auto p-1" role="listbox">
            {items.length === 0 && query.trim().length >= 2 && !loading && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                Aucun résultat pour « {query} »
              </div>
            )}

            {sections.map(([section, entries]) => (
              <div key={section} className="mb-1 last:mb-0">
                <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {section}
                </div>
                <ul className="space-y-0.5">
                  {entries.map(({ item, flatIndex }) => {
                    const Icon = item.icon;
                    const active = flatIndex === activeIndex;
                    const content = (
                      <div
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                          active
                            ? "bg-teranga-gold/10 text-teranga-gold"
                            : "text-foreground hover:bg-muted",
                        )}
                      >
                        <Icon
                          className="h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <div className="flex-1 truncate">
                          <div className="truncate">{item.label}</div>
                          {item.sublabel && (
                            <div className="truncate text-[11px] text-muted-foreground">
                              {item.sublabel}
                            </div>
                          )}
                        </div>
                        {active && (
                          <ArrowRight
                            className="h-3.5 w-3.5 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                      </div>
                    );
                    return (
                      <li
                        key={`${item.kind}-${item.href ?? item.label}`}
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                      >
                        {item.href ? (
                          <Link href={item.href} onClick={onClose} className="block">
                            {content}
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              item.onSelect?.();
                              onClose();
                            }}
                            className="block w-full text-left"
                          >
                            {content}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
            <div>
              <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono">
                ↑↓
              </kbd>
              {" pour naviguer · "}
              <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono">
                ↵
              </kbd>
              {" pour ouvrir · "}
              <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono">
                Esc
              </kbd>
              {" pour fermer"}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
