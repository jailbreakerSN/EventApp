"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { useAdminRole } from "@/hooks/use-admin-role";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ThemeToggle, NotificationBell, type NotificationBellRow } from "@teranga/shared-ui";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Keyboard, LogOut, Menu, Search, Shield } from "lucide-react";
import {
  useNotifications,
  useUnreadCount,
  useMarkAsRead,
  useMarkAllAsRead,
} from "@/hooks/use-notifications";
import { useNotificationLiveStream } from "@/hooks/use-notification-live-stream";
import { useSidebar } from "./sidebar-context";

// Localised "il y a N min" formatter. `date-fns` isn't installed in this
// workspace (see apps/web-backoffice/package.json — only zod + react-query
// are in the dep tree), so we roll a tiny Intl-native helper mirroring the
// one in src/app/(dashboard)/notifications/page.tsx. Kept inline on the
// topbar so the bell has no cross-file coupling — if we need it in >1
// place, lift to a shared util.
function formatRelative(iso: string): string {
  const now = new Date();
  const date = new Date(iso);
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 1) return "À l'instant";
  if (diffMinutes < 60) return `Il y a ${diffMinutes} min`;
  if (diffHours < 24) return `Il y a ${diffHours} h`;
  if (diffDays === 1) return "Hier";
  if (diffDays < 7) return `Il y a ${diffDays} j`;
  return date.toLocaleDateString("fr-SN", { day: "numeric", month: "short" });
}

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  super_admin: {
    label: "Super Admin",
    color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  },
  organizer: {
    label: "Organisateur",
    color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  },
  co_organizer: {
    label: "Co-organisateur",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  },
  staff: {
    label: "Staff",
    color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  },
  participant: { label: "Participant", color: "bg-accent text-muted-foreground" },
};

interface TopBarProps {
  onShowShortcuts?: () => void;
}

export function TopBar({ onShowShortcuts }: TopBarProps) {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { isOpen, toggle } = useSidebar();
  const router = useRouter();
  const tNav = useTranslations("admin.nav");

  // Bridge back to the admin shell — rendered only when the viewer holds
  // an admin role. A pure organizer/co-organizer never sees this button,
  // so there is no regression for the primary persona of this shell.
  const adminRole = useAdminRole();

  const primaryRole = user?.roles?.[0] ?? "participant";
  const roleInfo = ROLE_LABELS[primaryRole] ?? ROLE_LABELS.participant;

  // Bell data — first page only (10 rows); the full history lives at
  // /account/notifications/history. We deliberately don't gate behind
  // `user` because the topbar only renders inside the authenticated
  // (dashboard) layout.
  const {
    data: notifData,
    isLoading: notifLoading,
    error: notifError,
  } = useNotifications({ page: 1, limit: 10 });
  const { data: unreadData } = useUnreadCount();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  // Real-time subscriber: invalidates the react-query cache + fires a
  // default toast when a new notification is persisted to Firestore for
  // the current user. Kept side-effect-only (no return value) — the panel
  // content + unread badge are still driven by the React Query hooks above.
  useNotificationLiveStream();

  const notifications: NotificationBellRow[] = (notifData?.data ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    createdAt: n.createdAt,
    isRead: n.isRead,
    type: n.type,
    // `data` is `Record<string, string>` on the Notification schema, so
    // we pluck the Phase 2.5 `deepLink` contract the API sets on emits
    // (see apps/api/src/services/notification.service.ts — params.data
    // carries deepLink for dashboard routes like /events/:id,
    // /registrations, /organization/billing). Falls back to undefined
    // so the bell renders a plain button, not an anchor, when absent.
    href: n.data?.deepLink || undefined,
  }));
  const unreadCount = unreadData?.data?.count ?? 0;

  return (
    <header className="h-14 bg-card border-b border-border flex items-center justify-between px-4 sm:px-6 shrink-0">
      {/* Left: hamburger on mobile */}
      <div className="flex items-center">
        <button
          onClick={toggle}
          className="lg:hidden p-2 -ml-1 rounded-lg hover:bg-accent motion-safe:transition-colors"
          aria-label={isOpen ? "Fermer le menu" : "Ouvrir le menu"}
          aria-expanded={isOpen}
          aria-controls="mobile-sidebar"
        >
          <Menu size={20} className="text-foreground" aria-hidden="true" />
        </button>
      </div>

      {/* Centre / Left-of-right: Cmd+K trigger */}
      <button
        onClick={() => {
          // Dispatch a synthetic Ctrl+K event to let the CommandPalette's global listener handle it
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "k", ctrlKey: true, metaKey: true, bubbles: true }),
          );
        }}
        className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-muted hover:bg-accent text-muted-foreground motion-safe:transition-colors text-xs"
        aria-label="Ouvrir la palette de commandes (Ctrl+K)"
        title="Palette de commandes"
      >
        <Search size={13} aria-hidden="true" />
        <span>Rechercher…</span>
        <kbd className="ml-1 font-mono text-[10px] bg-background border border-border rounded px-1 py-0.5 leading-none">
          ⌘K
        </kbd>
      </button>

      {/* Right: actions */}
      <div className="flex items-center gap-3">
        {adminRole && (
          <Link
            href="/admin/inbox"
            className="hidden sm:inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 motion-safe:transition-colors dark:border-teranga-gold/40 dark:bg-teranga-gold/10 dark:text-teranga-gold dark:hover:bg-teranga-gold/20"
            aria-label={tNav("administrationPillAria")}
            title={tNav("administrationPillAria")}
          >
            <Shield className="h-3.5 w-3.5" aria-hidden="true" />
            {tNav("administrationPill")}
          </Link>
        )}
        <LanguageSwitcher />
        <ThemeToggle theme={theme} setTheme={setTheme} />

        {/* Keyboard shortcuts hint */}
        <button
          onClick={onShowShortcuts}
          className="hidden sm:flex items-center gap-1 p-2 rounded-lg hover:bg-accent motion-safe:transition-colors"
          aria-label="Raccourcis clavier (?)"
          title="Raccourcis clavier (?)"
        >
          <Keyboard size={17} className="text-muted-foreground" aria-hidden="true" />
        </button>

        <NotificationBell
          notifications={notifications}
          unreadCount={unreadCount}
          isLoading={notifLoading}
          errorMessage={
            notifError ? "Impossible de charger les notifications. Réessayez plus tard." : undefined
          }
          formatRelative={formatRelative}
          seeAllHref="/account/notifications/history"
          onRowClick={(row) => {
            if (!row.isRead) {
              markAsRead.mutate(row.id);
            }
            // Prefer the notification's own deep-link; fall back to the
            // history page so the user always lands somewhere useful even
            // when the denorm listener didn't set one.
            router.push(row.href ?? "/account/notifications/history");
          }}
          onMarkAllRead={() => markAllAsRead.mutate()}
        />

        <div className="flex items-center gap-2">
          {user?.photoURL ? (
            <img
              src={user.photoURL}
              alt={user.displayName ? `Photo de profil de ${user.displayName}` : "Photo de profil"}
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div
              className="w-8 h-8 rounded-full bg-primary flex items-center justify-center"
              aria-hidden="true"
            >
              <span className="text-white text-xs font-bold">
                {user?.displayName?.[0]?.toUpperCase() ?? "?"}
              </span>
            </div>
          )}
          <div className="hidden md:flex flex-col">
            <span className="text-sm text-foreground font-medium leading-tight">
              {user?.displayName}
            </span>
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full w-fit ${roleInfo.color}`}
            >
              {roleInfo.label}
            </span>
          </div>
        </div>

        <button
          onClick={() => logout()}
          className="p-2 rounded-lg hover:bg-accent motion-safe:transition-colors"
          title="Déconnexion"
          aria-label="Déconnexion"
        >
          <LogOut size={17} className="text-muted-foreground" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
