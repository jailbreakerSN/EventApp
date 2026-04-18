"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";

/**
 * Register the service worker and keep it in sync with the active
 * next-intl locale. The SW uses the locale to key its caches
 * (teranga-v2-static-{locale}) so offline users see their own
 * language's `/offline` page instead of whichever locale happened
 * to populate the cache first.
 */
export function SwRegister() {
  const locale = useLocale();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        const send = (controller: ServiceWorker | null) => {
          if (!controller) return;
          controller.postMessage({ type: "SET_LOCALE", locale });
        };
        // Fire on initial ready and whenever the controlling SW changes
        // (first install, post-update, etc.).
        send(navigator.serviceWorker.controller);
        if (reg.active) send(reg.active);
      })
      .catch(() => {
        // SW registration failed — silently ignore; the app still works online.
      });
  }, [locale]);

  // Re-broadcast locale changes so the SW can swap cache targets without
  // waiting for the next navigation.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const controller = navigator.serviceWorker.controller;
    if (!controller) return;
    controller.postMessage({ type: "LOCALE_CHANGED", locale });
  }, [locale]);

  return null;
}
