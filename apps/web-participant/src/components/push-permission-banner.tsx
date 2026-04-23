"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Bell, X } from "lucide-react";
import { useWebPushRegistration } from "@/hooks/use-web-push-registration";
import { useIsPwa } from "@/hooks/use-is-pwa";

// ─── Push Permission Banner (Phase C.2 — Participant) ───────────────────────
// Renders an inline, dismissible CTA prompting the user to enable Web Push.
// Strict invariants (per CLAUDE.md "meaningful moments" rule):
//   - Never on page load. Callers mount this component ONLY after the user
//     hits a meaningful action (registration confirmed, settings visited, …).
//   - Never more than 3 dismissals, with a 7-day cooldown in between.
//   - Only when permission === "default". At "denied" we render a brief
//     help nudge directing the user to their browser settings (the
//     browser will silently ignore a repeat prompt at that point).
//   - prefers-reduced-motion disables the slide-in animation.
//   - Focus returns to the element that spawned the banner on dismiss.
//
// Copy comes from notifications.push.permission_banner.* in messages/*.json.

const DISMISS_COUNT_KEY = "teranga.push.banner.dismissCount";
const DISMISS_AT_KEY = "teranga.push.banner.dismissedAt";
// Phase D.5: one-shot marker so the "pwa-installed" trigger only auto-shows
// once per browser. After the first ask we defer to the existing cadence.
const PWA_INSTALLED_SHOWN_KEY = "teranga.push.banner.pwaInstalledShown";
// Short delay before the post-install auto-prompt so we don't race iOS
// repainting the status bar + splash screen on the first standalone launch.
const PWA_INSTALLED_DELAY_MS = 5_000;
const MAX_DISMISSALS = 3;
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days.

export type PushBannerTrigger =
  | "post-first-action"
  | "settings-page"
  | "registration-confirmed"
  // Phase D.5: fired once when a user opens the PWA for the first time on
  // iOS. The push banner is delayed 5s after mount to let the splash settle.
  | "pwa-installed";

interface PushPermissionBannerProps {
  /** Which meaningful moment triggered this banner — used for analytics only. */
  trigger: PushBannerTrigger;
  className?: string;
}

function readDismissCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(DISMISS_COUNT_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isNaN(parsed) ? 0 : parsed;
  } catch {
    return 0;
  }
}

function readDismissedAt(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(DISMISS_AT_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isNaN(parsed) ? 0 : parsed;
  } catch {
    return 0;
  }
}

function writeDismissal(count: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISS_COUNT_KEY, String(count));
    window.localStorage.setItem(DISMISS_AT_KEY, String(Date.now()));
  } catch {
    // Storage quota or private-mode — banner simply re-shows next mount.
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// iOS Safari only exposes the Notification API inside the PWA context (post
// "Add to Home Screen"). Other platforms have had the chance via the
// post-first-action / registration-confirmed triggers already, so the
// pwa-installed auto-prompt is iOS-only to avoid double-nagging.
function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIpadOs = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  return /iPad|iPhone|iPod/.test(ua) || isIpadOs;
}

function readPwaInstalledShown(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PWA_INSTALLED_SHOWN_KEY) === "true";
  } catch {
    return false;
  }
}

function writePwaInstalledShown(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PWA_INSTALLED_SHOWN_KEY, "true");
  } catch {
    // best-effort
  }
}

export function PushPermissionBanner({ trigger, className }: PushPermissionBannerProps) {
  const t = useTranslations("notifications.push");
  const { permission, isRegistering, register } = useWebPushRegistration();
  const isPwa = useIsPwa();
  const [visible, setVisible] = useState(false);
  const [showDeniedHelp, setShowDeniedHelp] = useState(false);
  const [animate, setAnimate] = useState(false);
  const triggerElRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (permission === "unsupported") {
      setVisible(false);
      setShowDeniedHelp(false);
      return;
    }
    if (permission === "denied") {
      // One-liner help rather than the full banner — re-prompting is
      // a no-op at this point, so guide the user to browser settings.
      setVisible(false);
      setShowDeniedHelp(true);
      return;
    }
    if (permission !== "default") {
      setVisible(false);
      setShowDeniedHelp(false);
      return;
    }
    const count = readDismissCount();
    if (count >= MAX_DISMISSALS) {
      setVisible(false);
      return;
    }
    const dismissedAt = readDismissedAt();
    if (dismissedAt > 0 && Date.now() - dismissedAt < COOLDOWN_MS) {
      setVisible(false);
      return;
    }

    // Phase D.5: the pwa-installed trigger is a fire-and-forget post-install
    // nudge. We only want it (a) on iOS — every other platform has had the
    // chance via the post-first-action / registration-confirmed triggers
    // already — (b) while `useIsPwa()` reports true, (c) exactly once per
    // browser (`PWA_INSTALLED_SHOWN_KEY`), and (d) after a 5s delay so the
    // iOS splash-screen animation is out of the way.
    if (trigger === "pwa-installed") {
      if (isPwa !== true) {
        setVisible(false);
        return;
      }
      if (!isIosSafari()) {
        setVisible(false);
        return;
      }
      if (readPwaInstalledShown()) {
        setVisible(false);
        return;
      }
      const timer = window.setTimeout(() => {
        writePwaInstalledShown();
        if (typeof document !== "undefined") {
          triggerElRef.current = (document.activeElement as HTMLElement) ?? null;
        }
        setVisible(true);
        setAnimate(!prefersReducedMotion());
      }, PWA_INSTALLED_DELAY_MS);
      return () => window.clearTimeout(timer);
    }

    if (typeof document !== "undefined") {
      triggerElRef.current = (document.activeElement as HTMLElement) ?? null;
    }
    setVisible(true);
    setAnimate(!prefersReducedMotion());
  }, [permission, trigger, isPwa]);

  const handleActivate = useCallback(async () => {
    const result = await register();
    if (result.ok) {
      toast.success(t("registration.success"));
      setVisible(false);
      return;
    }
    switch (result.reason) {
      case "permission_denied":
        toast.error(t("denied_help"));
        setVisible(false);
        setShowDeniedHelp(true);
        break;
      case "rate_limited":
        toast.error(t("registration.rate_limited"));
        // Keep the banner visible — the user may retry later.
        break;
      case "unsupported":
        toast.error(t("registration.unsupported"));
        setVisible(false);
        break;
      case "error":
      default:
        toast.error(t("registration.failure"));
        break;
    }
  }, [register, t]);

  const handleDismiss = useCallback(() => {
    const next = readDismissCount() + 1;
    writeDismissal(next);
    setVisible(false);
    queueMicrotask(() => {
      triggerElRef.current?.focus();
    });
  }, []);

  // Denied-at-browser-level: render a quiet one-liner pointing to the
  // browser settings, no CTA (the prompt is a no-op once denied).
  if (showDeniedHelp) {
    return (
      <div
        role="status"
        aria-label={t("permission_banner.title")}
        data-trigger={trigger}
        className={[
          "flex items-start gap-2 rounded-card border bg-muted/40 p-3 text-xs text-muted-foreground",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <Bell className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        <p>{t("denied_help")}</p>
      </div>
    );
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label={t("permission_banner.title")}
      data-trigger={trigger}
      className={[
        "relative flex flex-wrap items-start gap-3 rounded-card border border-teranga-gold/40 bg-teranga-gold/10 p-4 text-sm dark:border-teranga-gold/30 dark:bg-teranga-gold/10",
        animate ? "animate-in fade-in slide-in-from-top-2 duration-300" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-teranga-gold/20 text-teranga-gold-dark">
        <Bell className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 text-left">
        <p className="font-semibold text-foreground">{t("permission_banner.title")}</p>
        <p className="mt-0.5 text-muted-foreground">{t("permission_banner.body")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleActivate}
            disabled={isRegistering}
            className="inline-flex items-center gap-1.5 rounded-full bg-teranga-navy px-4 py-1.5 text-xs font-semibold text-white hover:bg-teranga-navy/90 disabled:opacity-50 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light"
          >
            <Bell className="h-3.5 w-3.5" aria-hidden="true" />
            {isRegistering ? t("permission_banner.activating") : t("permission_banner.cta")}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t("permission_banner.dismiss")}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t("permission_banner.dismiss")}
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
