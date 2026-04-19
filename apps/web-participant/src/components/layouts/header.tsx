"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { Button, ThemeToggle } from "@teranga/shared-ui";
import { ThemeLogo } from "@/components/theme-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Menu, X, User, LogOut } from "lucide-react";

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
