"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  PlusCircle,
  Users,
  QrCode,
  BarChart3,
  Wallet,
  Megaphone,
  Bell,
  Building2,
  Settings,
  LogOut,
  Shield,
  MapPin,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

// ─── Types ──────────────────────────────────────────────────────────────────

type CommandCategory = "Pages" | "Actions";

interface CommandItem {
  id: string;
  label: string;
  category: CommandCategory;
  icon: LucideIcon;
  href?: string;
  action?: () => void | Promise<void>;
  hint?: string;
}

// ─── Static command definitions ──────────────────────────────────────────────

const PAGE_COMMANDS: Omit<CommandItem, "action">[] = [
  { id: "dashboard",      label: "Tableau de bord",  category: "Pages",   icon: LayoutDashboard, href: "/dashboard" },
  { id: "events",         label: "Événements",        category: "Pages",   icon: CalendarDays,    href: "/events" },
  { id: "events-new",     label: "Nouvel événement",  category: "Pages",   icon: PlusCircle,      href: "/events/new" },
  { id: "participants",   label: "Participants",       category: "Pages",   icon: Users,           href: "/participants" },
  { id: "badges",         label: "Badges & QR",       category: "Pages",   icon: QrCode,          href: "/badges" },
  { id: "analytics",      label: "Analytiques",       category: "Pages",   icon: BarChart3,       href: "/analytics" },
  { id: "finance",        label: "Finances",          category: "Pages",   icon: Wallet,          href: "/finance" },
  { id: "communications", label: "Communications",    category: "Pages",   icon: Megaphone,       href: "/communications" },
  { id: "notifications",  label: "Notifications",     category: "Pages",   icon: Bell,            href: "/notifications" },
  { id: "organization",   label: "Organisation",      category: "Pages",   icon: Building2,       href: "/organization" },
  { id: "settings",       label: "Paramètres",        category: "Pages",   icon: Settings,        href: "/settings" },
  // Admin pages (visible to all in search, but access-gated by route layout)
  { id: "admin",          label: "Admin Plateforme",  category: "Pages",   icon: Shield,          href: "/admin" },
  { id: "admin-users",    label: "Admin Utilisateurs", category: "Pages",  icon: Users,           href: "/admin/users" },
  { id: "admin-orgs",     label: "Admin Organisations", category: "Pages", icon: Building2,       href: "/admin/organizations" },
  { id: "admin-events",   label: "Admin Événements",  category: "Pages",   icon: CalendarDays,    href: "/admin/events" },
  { id: "admin-venues",   label: "Admin Lieux",       category: "Pages",   icon: MapPin,          href: "/admin/venues" },
  { id: "admin-audit",    label: "Journal d'audit",   category: "Pages",   icon: FileText,        href: "/admin/audit" },
];

// ─── Category badge colors ────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<CommandCategory, string> = {
  Pages:   "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  Actions: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  Pages:   "Page",
  Actions: "Action",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function CommandPalette() {
  const router = useRouter();
  const { logout } = useAuth();

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [mounted, setMounted] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // SSR safety for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Build full command list (actions need access to router/logout, built each render)
  const allCommands: CommandItem[] = [
    ...PAGE_COMMANDS.map((cmd) => ({
      ...cmd,
      action: () => {
        router.push(cmd.href!);
        close();
      },
    })),
    {
      id: "action-new-event",
      label: "Créer un événement",
      category: "Actions",
      icon: PlusCircle,
      action: () => {
        router.push("/events/new");
        close();
      },
    },
    {
      id: "action-logout",
      label: "Se déconnecter",
      category: "Actions",
      icon: LogOut,
      action: async () => {
        close();
        await logout();
      },
    },
  ];

  // ── Filtering ──────────────────────────────────────────────────────────────

  const q = query.toLowerCase().trim();
  const filtered = q
    ? allCommands.filter((cmd) => cmd.label.toLowerCase().includes(q))
    : allCommands;

  // Group by category while preserving order Pages → Actions
  const groups: { category: CommandCategory; items: CommandItem[] }[] = [];
  const seen = new Set<CommandCategory>();
  for (const cmd of filtered) {
    if (!seen.has(cmd.category)) {
      seen.add(cmd.category);
      groups.push({ category: cmd.category, items: [] });
    }
    groups[groups.length - 1]!.items.push(cmd);
  }

  // Flat ordered list for keyboard nav
  const flatItems = groups.flatMap((g) => g.items);

  // ── Open / close helpers ───────────────────────────────────────────────────

  function close() {
    setIsOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  // ── Keyboard shortcut — Cmd+K / Ctrl+K ────────────────────────────────────

  useEffect(() => {
    const handleGlobal = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((prev) => {
          if (prev) {
            setQuery("");
            setActiveIndex(0);
            return false;
          }
          setQuery("");
          setActiveIndex(0);
          return true;
        });
      }
      if (e.key === "Escape" && isOpen) {
        close();
      }
    };

    document.addEventListener("keydown", handleGlobal);
    return () => document.removeEventListener("keydown", handleGlobal);
  }, [isOpen]);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen) {
      // rAF ensures the portal is rendered before we focus
      const id = requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [isOpen]);

  // Reset active index when query/results change
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLLIElement>(`[data-index="${activeIndex}"]`);
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // ── Keyboard navigation inside the palette ────────────────────────────────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % Math.max(flatItems.length, 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + Math.max(flatItems.length, 1)) % Math.max(flatItems.length, 1));
          break;
        case "Enter":
          e.preventDefault();
          if (flatItems[activeIndex]) {
            flatItems[activeIndex].action?.();
          }
          break;
        case "Escape":
          e.preventDefault();
          close();
          break;
      }
    },
    [flatItems, activeIndex]
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!mounted || !isOpen) return null;

  const palette = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Palette de commandes"
      className={cn(
        "fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] px-4",
        // Overlay
        "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
      )}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={close}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className={cn(
          "relative w-full max-w-lg",
          "bg-card text-foreground",
          "rounded-xl border border-border shadow-2xl",
          "overflow-hidden",
          "motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-150"
        )}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <svg
            className="w-4 h-4 text-muted-foreground shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={true}
            aria-autocomplete="list"
            aria-controls="command-palette-list"
            aria-activedescendant={
              flatItems[activeIndex] ? `cmd-${flatItems[activeIndex].id}` : undefined
            }
            type="text"
            placeholder="Rechercher une page ou une action..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className={cn(
              "flex-1 bg-transparent outline-none",
              "text-sm text-foreground placeholder:text-muted-foreground"
            )}
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="p-0.5 rounded text-muted-foreground hover:text-foreground motion-safe:transition-colors"
              aria-label="Effacer la recherche"
              tabIndex={-1}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
          <kbd className="hidden sm:flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted border border-border rounded px-1.5 py-0.5 shrink-0 font-mono">
            Échap
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[min(60vh,400px)] overflow-y-auto overscroll-contain">
          {flatItems.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-muted-foreground">
                Aucun résultat pour{" "}
                <span className="text-foreground font-medium">&quot;{query}&quot;</span>
              </p>
            </div>
          ) : (
            <ul
              ref={listRef}
              id="command-palette-list"
              role="listbox"
              aria-label="Résultats de la recherche"
              className="py-2"
            >
              {groups.map(({ category, items }) => (
                <li key={category} role="presentation">
                  {/* Category header */}
                  <div className="px-4 py-1.5">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      {category}
                    </span>
                  </div>

                  {/* Items */}
                  <ul role="presentation">
                    {items.map((item) => {
                      const globalIndex = flatItems.indexOf(item);
                      const isActive = globalIndex === activeIndex;
                      const Icon = item.icon;

                      return (
                        <li
                          key={item.id}
                          id={`cmd-${item.id}`}
                          role="option"
                          aria-selected={isActive}
                          data-index={globalIndex}
                          onClick={() => item.action?.()}
                          onMouseEnter={() => setActiveIndex(globalIndex)}
                          className={cn(
                            "flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg cursor-pointer",
                            "motion-safe:transition-colors",
                            isActive
                              ? "bg-primary/10 text-primary"
                              : "text-foreground hover:bg-muted"
                          )}
                        >
                          <Icon
                            size={16}
                            aria-hidden="true"
                            className={cn(
                              "shrink-0",
                              isActive ? "text-primary" : "text-muted-foreground"
                            )}
                          />
                          <span className="flex-1 text-sm font-medium truncate">
                            {item.label}
                          </span>
                          <span
                            className={cn(
                              "text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0",
                              CATEGORY_STYLES[item.category]
                            )}
                          >
                            {CATEGORY_LABELS[item.category]}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-border px-4 py-2.5 flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <kbd className="font-mono bg-muted border border-border rounded px-1 py-0.5">↑</kbd>
            <kbd className="font-mono bg-muted border border-border rounded px-1 py-0.5">↓</kbd>
            Naviguer
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="font-mono bg-muted border border-border rounded px-1 py-0.5">↵</kbd>
            Sélectionner
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="font-mono bg-muted border border-border rounded px-1 py-0.5">Échap</kbd>
            Fermer
          </span>
        </div>
      </div>
    </div>
  );

  return createPortal(palette, document.body);
}
