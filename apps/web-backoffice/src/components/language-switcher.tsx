"use client";

import { useLocale } from "next-intl";
import { LanguageSwitcher as SharedLanguageSwitcher } from "@teranga/shared-ui";

/**
 * Next.js wrapper around the framework-agnostic <LanguageSwitcher>
 * primitive from shared-ui.
 *
 * `router.refresh()` only re-runs the server render — any client
 * component above the change keeps its cached state, so users
 * experienced the UI staying in French even after flipping the cookie.
 * Forcing a full reload re-mounts every tree from scratch and guarantees
 * next-intl picks up the new locale everywhere.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();

  return (
    <SharedLanguageSwitcher
      locale={locale}
      onChange={() => {
        if (typeof window !== "undefined") {
          window.location.reload();
        }
      }}
      className={className}
    />
  );
}
