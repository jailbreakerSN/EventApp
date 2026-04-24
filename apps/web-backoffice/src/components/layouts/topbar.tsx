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

// Role → color class. Labels are pulled from `common.roles.*` at render
// time so each locale renders its own spelling. The palette stays bound
// to the role key (not the label) so localization does not alter visual
// identity. The `participant` fallback is keyed generically.
const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  "platform:super_admin":
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  "platform:support": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  "platform:finance": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  "platform:ops": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  "platform:security": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  organizer: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  co_organizer: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  venue_manager: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  staff: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  speaker: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  sponsor: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  participant: "bg-accent text-muted-foreground",
};

type RoleKey = keyof typeof ROLE_COLORS;

/**
 * Highest-privilege role the user holds, used for the topbar chip.
 *
 * Picking `roles[0]` (the previous behaviour) was wrong: Firestore
 * stores roles in insertion order, so a user with
 * `["participant", "venue_manager"]` — the common shape for venue
 * managers who also register as participants — rendered as
 * "Participant" in the chip while the sidebar showed the
 * venue-manager nav. Operator confusion followed.
 *
 * The priority order mirrors `resolveLandingRoute` in `lib/access.ts`:
 * admin tier before org tier before venue tier before baseline. A
 * super-admin who also holds `organizer` shows as super_admin.
 */
const ROLE_PRIORITY: readonly RoleKey[] = [
  "super_admin",
  "platform:super_admin",
  "platform:security",
  "platform:ops",
  "platform:finance",
  "platform:support",
  "organizer",
  "co_organizer",
  "venue_manager",
  "staff",
  "speaker",
  "sponsor",
  "participant",
];

function pickPrimaryRole(roles: readonly string[]): RoleKey {
  for (const candidate of ROLE_PRIORITY) {
    if (roles.includes(candidate)) return candidate;
  }
  // User holds only unknown / future roles — render the neutral chip.
  return "participant";
}

interface TopBarProps {
  onShowShortcuts?: () => void;
}

export function TopBar({ onShowShortcuts }: TopBarProps) {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { isOpen, toggle } = useSidebar();
  const router = useRouter();
  const tNav = useTranslations("admin.nav");
  const tBar = useTranslations("common.topbar");
  const tRoles = useTranslations("common.roles");

  // Bridge back to the admin shell — rendered only when the viewer holds
  // an admin role. A pure organizer/co-organizer never sees this button,
  // so there is no regression for the primary persona of this shell.
  const adminRole = useAdminRole();

  const primaryRole: RoleKey = pickPrimaryRole(user?.roles ?? []);
  const roleColor = ROLE_COLORS[primaryRole];
  // i18n keys cover `super_admin`, `organizer`, `co_organizer`, `staff`,
  // `participant`. Platform subroles + venue_manager + speaker + sponsor
  // fall through to a generic fallback so we never render a raw i18n key.
  const roleLabel = (() => {
    try {
      return tRoles(primaryRole);
    } catch {
      return tRoles("participant");
    }
  })();

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
          aria-label={isOpen ? tBar("menuClose") : tBar("menuOpen")}
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
        aria-label={tBar("paletteAria")}
        title={tBar("paletteTitle")}
      >
        <Search size={13} aria-hidden="true" />
        <span>{tBar("paletteLabel")}</span>
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
          aria-label={tBar("shortcutsAria")}
          title={tBar("shortcutsAria")}
        >
          <Keyboard size={17} className="text-muted-foreground" aria-hidden="true" />
        </button>

        <NotificationBell
          notifications={notifications}
          unreadCount={unreadCount}
          isLoading={notifLoading}
          errorMessage={notifError ? tBar("notificationsError") : undefined}
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
              alt={
                user.displayName
                  ? tBar("avatarAltNamed", { name: user.displayName })
                  : tBar("avatarAltGeneric")
              }
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
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full w-fit ${roleColor}`}
            >
              {roleLabel}
            </span>
          </div>
        </div>

        <button
          onClick={() => logout()}
          className="p-2 rounded-lg hover:bg-accent motion-safe:transition-colors"
          title={tBar("logoutAria")}
          aria-label={tBar("logoutAria")}
        >
          <LogOut size={17} className="text-muted-foreground" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
