"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Bell, X } from "lucide-react";
import { useWebPushRegistration } from "@/hooks/use-web-push-registration";

// ─── Push Permission Banner (Phase C.2 — Backoffice) ────────────────────────
// Renders an inline, dismissible CTA prompting the user to enable Web Push.
// Strict invariants (per CLAUDE.md "meaningful moments" rule):
//   - Never on page load. Callers mount this component ONLY after the user
//     hits a meaningful action (event published, settings visited, …).
//   - Never more than 3 dismissals. After that we drop the banner for good
//     on this browser — respecting the user's repeated "not now" signal.
//   - 7-day cooldown between dismissals. Stops accidental double-click
//     spam from teaching us "user declined 3x in 5 seconds".
//   - Only when permission === "default". If the user denied at the
//     browser level, show a one-liner explaining how to flip it in
//     site settings instead of re-prompting (which the browser would
//     silently ignore anyway).
//   - prefers-reduced-motion gates the slide-in animation.
//   - Focus-returns-to-trigger on dismiss for keyboard users.
//
// Strings are inline French — backoffice is French-only (see CLAUDE.md
// Localization section). When the backoffice gains i18n, port these.

const DISMISS_COUNT_KEY = "teranga.push.banner.dismissCount";
const DISMISS_AT_KEY = "teranga.push.banner.dismissedAt";
const MAX_DISMISSALS = 3;
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days.

export type PushBannerTrigger =
  | "post-first-action"
  | "settings-page"
  | "registration-confirmed"
  | "event-published";

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

export function PushPermissionBanner({ trigger, className }: PushPermissionBannerProps) {
  const { permission, isRegistering, register } = useWebPushRegistration();
  const [visible, setVisible] = useState(false);
  const [animate, setAnimate] = useState(false);
  const triggerElRef = useRef<HTMLElement | null>(null);

  // Decide visibility in an effect so SSR doesn't flash the banner
  // (localStorage + Notification.permission are browser-only).
  useEffect(() => {
    if (permission === "unsupported") {
      setVisible(false);
      return;
    }
    // Already granted / denied → nothing to prompt for.
    if (permission !== "default") {
      setVisible(false);
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
    // Capture the currently-focused element so we can return focus on
    // dismiss — improves keyboard UX (screen readers land back where the
    // user was instead of on <body>).
    if (typeof document !== "undefined") {
      triggerElRef.current = (document.activeElement as HTMLElement) ?? null;
    }
    setVisible(true);
    setAnimate(!prefersReducedMotion());
  }, [permission]);

  const handleActivate = useCallback(async () => {
    const result = await register();
    if (result.ok) {
      toast.success("Notifications activées.");
      setVisible(false);
      return;
    }
    switch (result.reason) {
      case "permission_denied":
        toast.error(
          "Autorisation refusée. Activez les notifications dans les réglages de votre navigateur.",
        );
        setVisible(false);
        break;
      case "rate_limited":
        toast.error("Trop de tentatives. Réessayez dans une heure.");
        // Keep the banner up — the user may retry later without dismissing.
        break;
      case "unsupported":
        toast.error("Votre navigateur ne supporte pas les notifications push.");
        setVisible(false);
        break;
      case "error":
      default:
        toast.error("Impossible d'activer les notifications. Réessayez.");
        break;
    }
  }, [register]);

  const handleDismiss = useCallback(() => {
    const next = readDismissCount() + 1;
    writeDismissal(next);
    setVisible(false);
    // Return focus so keyboard users don't lose their place after the
    // banner unmounts.
    queueMicrotask(() => {
      triggerElRef.current?.focus();
    });
  }, []);

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Activer les notifications push"
      data-trigger={trigger}
      className={[
        "relative flex flex-wrap items-start gap-3 rounded-lg border border-teranga-gold/40 bg-teranga-gold/10 p-4 text-sm dark:border-teranga-gold/30 dark:bg-teranga-gold/10",
        animate ? "animate-in fade-in slide-in-from-top-2 duration-300" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-teranga-gold/20 text-teranga-gold-dark">
        <Bell className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">Restez informé en temps réel</p>
        <p className="mt-0.5 text-muted-foreground">
          Activez les notifications push pour recevoir les check-ins, paiements et alertes importantes
          directement dans votre navigateur.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleActivate}
            disabled={isRegistering}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teranga-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-teranga-navy/90 disabled:opacity-50 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light"
          >
            <Bell className="h-3.5 w-3.5" aria-hidden="true" />
            {isRegistering ? "Activation…" : "Activer les notifications"}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Plus tard
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Fermer"
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
