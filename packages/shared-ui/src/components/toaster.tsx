"use client";

import { useEffect, useState } from "react";
import { Toaster as SonnerToaster } from "sonner";
import { DEFAULT_UI_LOCALE_FR, type ToasterLabels } from "../lib/i18n";

const MOBILE_BREAKPOINT = "(max-width: 639px)";
const DESKTOP_POSITION = "bottom-right" as const;
const MOBILE_POSITION = "top-center" as const;

type ToastPosition = typeof DESKTOP_POSITION | typeof MOBILE_POSITION;

export interface ToasterProps {
  /** Localised labels; unspecified keys fall back to French. */
  labels?: Partial<ToasterLabels>;
}

/**
 * Breakpoint-aware toast placement (ui-ux-pro-max rule 55).
 *
 * - Desktop (≥ 640 px): bottom-right (does not collide with sticky CTAs).
 * - Mobile (< 640 px):  top-center (avoids collision with sticky bottom CTAs
 *                       and the participant FAB).
 *
 * SSR-safe: renders the desktop position on the server and during the first
 * client paint, then upgrades via `matchMedia` on mount. This avoids a
 * hydration mismatch while still snapping to `top-center` before the first
 * toast is displayed on a mobile viewport.
 */
export function Toaster({ labels }: ToasterProps = {}) {
  const [position, setPosition] = useState<ToastPosition>(DESKTOP_POSITION);
  const l = { ...DEFAULT_UI_LOCALE_FR.toaster, ...labels };

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia(MOBILE_BREAKPOINT);
    const sync = () => setPosition(mq.matches ? MOBILE_POSITION : DESKTOP_POSITION);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return (
    <SonnerToaster
      position={position}
      richColors
      closeButton
      // Sonner renders toasts inside a <ol> with role="region" and aria-label.
      // We set the accessible label in French for screen readers.
      toastOptions={{
        duration: 4000,
        className: "text-sm",
      }}
      aria-label={l.region}
    />
  );
}
