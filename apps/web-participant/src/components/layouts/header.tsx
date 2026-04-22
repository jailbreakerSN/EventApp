"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "next-themes";
import { useLocale, useTranslations } from "next-intl";
import {
  Button,
  ThemeToggle,
  NotificationBell,
  type NotificationBellRow,
} from "@teranga/shared-ui";
import { ThemeLogo } from "@/components/theme-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Bell, Menu, X, User, LogOut } from "lucide-react";
import {
  useMarkAllAsRead,
  useMarkAsRead,
  useNotifications,
  useUnreadCount,
} from "@/hooks/use-notifications";
import { intlLocale } from "@/lib/intl-locale";

/**
 * Notification bell + its data hooks, extracted so React-Query only fires
 * the /v1/notifications requests when a user is actually signed in. The
 * existing hooks don't expose an `enabled` flag (per the task contract we
 * can't modify them), so conditional mounting is the cleanest way to
 * avoid 401 spam on public marketing pages.
 */
function HeaderNotificationBell({ className }: { className?: string }) {
  const router = useRouter();
  const tNav = useTranslations("nav");
  const tBell = useTranslations("notifications.bell");
  const tRel = useTranslations("notifications.relative");
  const locale = useLocale();
  const regional = intlLocale(locale);

  const {
    data: notifData,
    isLoading: notifLoading,
    error: notifError,
  } = useNotifications({ page: 1, limit: 10 });
  const { data: unreadData } = useUnreadCount();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  const notifications: NotificationBellRow[] = (notifData?.data ?? []).map(
    (n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      createdAt: n.createdAt,
      isRead: n.isRead,
      type: n.type,
      // `data` is `Record<string, string>` on the Notification schema —
      // the API emits `deepLink` for routable notifications (e.g.
      // /events/:slug, /my-events, /notifications). Absent means the
      // row is informational only and renders as a <button>.
      href: n.data?.deepLink || undefined,
    }),
  );
  const unreadCount = unreadData?.data?.count ?? 0;

  // Localised "il y a N min" formatter. `date-fns` isn't a dep in this
  // workspace (see package.json) so we reuse the Intl-native pattern
  // already established in /apps/web-participant/src/app/(authenticated)/
  // messages/page.tsx — closes over the active locale's `tRel` and the
  // BCP-47 regional code resolved by `intlLocale()`.
  const formatRelative = (iso: string): string => {
    const now = Date.now();
    const then = new Date(iso).getTime();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return tRel("now");
    if (diffMin < 60) return tRel("minutesShort", { n: diffMin });
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return tRel("hoursShort", { n: diffH });
    const diffD = Math.floor(diffH / 24);
    if (diffD === 1) return tRel("yesterday");
    if (diffD < 7) return tRel("daysShort", { n: diffD });
    return new Date(iso).toLocaleDateString(regional, {
      day: "numeric",
      month: "short",
    });
  };

  return (
    <NotificationBell
      className={className}
      notifications={notifications}
      unreadCount={unreadCount}
      isLoading={notifLoading}
      errorMessage={notifError ? tBell("errorMessage") : undefined}
      formatRelative={formatRelative}
      seeAllHref="/notifications"
      labels={{
        triggerAria: tBell("triggerAria"),
        title: tNav("notifications"),
        markAllRead: tBell("markAllRead"),
        seeAll: tBell("seeAll"),
        emptyTitle: tBell("emptyTitle"),
        emptyBody: tBell("emptyBody"),
        loading: tBell("loading"),
      }}
      onRowClick={(row) => {
        if (!row.isRead) {
          markAsRead.mutate(row.id);
        }
        // Soft-navigate when the notification has a deep link — otherwise
        // just close the panel and let the user decide.
        if (row.href) {
          router.push(row.href);
        }
      }}
      onMarkAllRead={() => markAllAsRead.mutate()}
    />
  );
}

/**
 * Lightweight unread-count pill used on the mobile menu entry. Separated
 * from the desktop bell so we only issue the /unread-count request once
 * when the user is signed in.
 */
function HeaderMobileUnreadBadge() {
  const tBell = useTranslations("notifications.bell");
  const { data: unreadData } = useUnreadCount();
  const unreadCount = unreadData?.data?.count ?? 0;
  if (unreadCount === 0) return null;
  const capped = unreadCount > 99 ? "99+" : String(unreadCount);
  return (
    <span
      aria-label={tBell("triggerAria").replace("{count}", String(unreadCount))}
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-teranga-gold px-1.5 text-[10px] font-semibold text-teranga-navy"
    >
      {capped}
    </span>
  );
}

export function Header() {
  const { user, loading, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const tNav = useTranslations("nav");
  const tAuth = useTranslations("auth");
  const tTheme = useTranslations("theme");

  const themeLabels = {
    group: tTheme("groupLabel"),
    light: tTheme("light"),
    dark: tTheme("dark"),
    system: tTheme("system"),
  };

  // aria-current helper — returns "page" when the current URL matches a top-
  // level route prefix, undefined otherwise. `startsWith` lets /events/[slug]
  // still light up the "Événements" nav link.
  const ariaCurrent = (href: string): "page" | undefined =>
    pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined;

  // Close the mobile menu on Escape and when the user navigates, and trap
  // focus inside the open panel for keyboard-only users.
  useEffect(() => {
    if (!mobileOpen) return;

    const panel = mobileNavRef.current;
    const firstFocusable = panel?.querySelector<HTMLElement>(
      "a, button, [tabindex]:not([tabindex='-1'])",
    );
    firstFocusable?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          "a, button:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((el) => !el.hasAttribute("aria-hidden"));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [mobileOpen]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-50 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label={tNav("brandHomeAria")} className="flex items-center gap-2">
          <ThemeLogo width={140} height={83} className="h-8 w-auto" priority />
        </Link>

        {/* Desktop nav */}
        <nav aria-label={tNav("mainAria")} className="hidden items-center gap-6 md:flex">
          <Link
            href="/events"
            aria-current={ariaCurrent("/events")}
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors aria-[current=page]:text-foreground aria-[current=page]:underline aria-[current=page]:underline-offset-8 aria-[current=page]:decoration-teranga-gold aria-[current=page]:decoration-2"
          >
            {tNav("events")}
          </Link>
          {!loading && user && (
            <Link
              href="/my-events"
              aria-current={ariaCurrent("/my-events")}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors aria-[current=page]:text-foreground aria-[current=page]:underline aria-[current=page]:underline-offset-8 aria-[current=page]:decoration-teranga-gold aria-[current=page]:decoration-2"
            >
              {tNav("myRegistrations")}
            </Link>
          )}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <LanguageSwitcher />
          <ThemeToggle theme={theme} setTheme={setTheme} labels={themeLabels} />
          {user && <HeaderNotificationBell />}
          {loading ? (
            <div className="h-9 w-20 animate-pulse rounded-md bg-muted" />
          ) : user ? (
            <div className="flex items-center gap-3">
              <Link
                href="/profile"
                aria-current={ariaCurrent("/profile")}
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                <User className="h-4 w-4" />
                {user.displayName ?? user.email}
              </Link>
              <Button variant="ghost" size="sm" onClick={logout} aria-label={tAuth("logout")}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  {tAuth("login")}
                </Button>
              </Link>
              <Link href="/register">
                <Button
                  size="sm"
                  className="bg-teranga-gold text-teranga-navy hover:bg-teranga-gold/90 dark:bg-teranga-gold-light dark:text-teranga-navy dark:hover:bg-teranga-gold"
                >
                  {tAuth("register")}
                </Button>
              </Link>
            </>
          )}
        </div>

        {/* Mobile menu toggle */}
        <button
          className="md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? tNav("closeMenu") : tNav("openMenu")}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
        >
          {mobileOpen ? (
            <X className="h-6 w-6" aria-hidden="true" />
          ) : (
            <Menu className="h-6 w-6" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <div ref={mobileNavRef} className="border-t bg-card px-4 py-4 md:hidden">
          <nav id="mobile-nav" aria-label={tNav("mobileAria")} className="flex flex-col gap-3">
            <Link
              href="/events"
              aria-current={ariaCurrent("/events")}
              className="text-sm font-medium aria-[current=page]:text-teranga-gold-dark"
              onClick={() => setMobileOpen(false)}
            >
              {tNav("events")}
            </Link>
            {user && (
              <Link
                href="/my-events"
                aria-current={ariaCurrent("/my-events")}
                className="text-sm font-medium aria-[current=page]:text-teranga-gold-dark"
                onClick={() => setMobileOpen(false)}
              >
                {tNav("myRegistrations")}
              </Link>
            )}
            {user ? (
              <>
                <Link
                  href="/notifications"
                  aria-current={ariaCurrent("/notifications")}
                  className="flex items-center justify-between gap-3 text-sm font-medium aria-[current=page]:text-teranga-gold-dark"
                  onClick={() => setMobileOpen(false)}
                >
                  <span className="flex items-center gap-2">
                    <Bell className="h-4 w-4" aria-hidden="true" />
                    {tNav("notifications")}
                  </span>
                  <HeaderMobileUnreadBadge />
                </Link>
                <Link
                  href="/profile"
                  aria-current={ariaCurrent("/profile")}
                  className="text-sm font-medium aria-[current=page]:text-teranga-gold-dark"
                  onClick={() => setMobileOpen(false)}
                >
                  {tNav("myProfile")}
                </Link>
                <button
                  className="text-left text-sm font-medium text-destructive"
                  onClick={() => {
                    logout();
                    setMobileOpen(false);
                  }}
                >
                  {tAuth("logout")}
                </button>
              </>
            ) : (
              <div className="flex gap-2 pt-2">
                <Link href="/login" className="flex-1">
                  <Button variant="outline" size="sm" className="w-full">
                    {tAuth("login")}
                  </Button>
                </Link>
                <Link href="/register" className="flex-1">
                  <Button
                    size="sm"
                    className="w-full bg-teranga-gold text-teranga-navy hover:bg-teranga-gold/90 dark:bg-teranga-gold-light dark:text-teranga-navy dark:hover:bg-teranga-gold"
                  >
                    {tAuth("register")}
                  </Button>
                </Link>
              </div>
            )}
            <div className="pt-3 border-t mt-3">
              <ThemeToggle theme={theme} setTheme={setTheme} labels={themeLabels} />
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
