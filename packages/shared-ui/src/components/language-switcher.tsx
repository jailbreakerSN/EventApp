"use client";

import * as React from "react";
import { Globe } from "lucide-react";
import { cn } from "../lib/utils";

/**
 * LanguageSwitcher — a compact locale picker that writes a cookie and
 * triggers a caller-provided refresh so next-intl picks up the new
 * messages.
 *
 * Consumers pass the cookie name + a refresh callback so this component
 * stays framework-agnostic (no direct dep on next/navigation). In a
 * Next.js app, prefer `window.location.reload()` over `router.refresh()`:
 * the latter only re-runs the server render and leaves any client
 * components above the switcher with their cached state, which makes
 * the UI appear to "stick" on the previous locale for end users.
 *
 * ```tsx
 * "use client";
 * import { useLocale } from "next-intl";
 * import { LanguageSwitcher } from "@teranga/shared-ui";
 *
 * export function Switcher() {
 *   const locale = useLocale();
 *   return (
 *     <LanguageSwitcher
 *       locale={locale}
 *       onChange={() => window.location.reload()}
 *     />
 *   );
 * }
 * ```
 */

export interface LanguageOption {
  value: string;
  label: string;
  /** Short 2-letter display code, e.g. "FR". Defaults to value.toUpperCase(). */
  shortCode?: string;
}

export const DEFAULT_LOCALES: LanguageOption[] = [
  { value: "fr", label: "Français", shortCode: "FR" },
  { value: "en", label: "English", shortCode: "EN" },
  { value: "wo", label: "Wolof", shortCode: "WO" },
];

export interface LanguageSwitcherProps {
  /** Current locale code. */
  locale: string;
  /**
   * Called after the cookie has been set. Typically calls
   * `router.refresh()` so next-intl re-reads messages on the next
   * server render.
   */
  onChange?: (locale: string) => void;
  /** Cookie name. Default: "NEXT_LOCALE" (next-intl's convention). */
  cookieName?: string;
  /** Cookie Max-Age in seconds. Default: 1 year. */
  cookieMaxAge?: number;
  /** Locale options to show. Default: fr / en / wo. */
  options?: LanguageOption[];
  /** Accessible label for the <select>. Default: "Choisir la langue". */
  ariaLabel?: string;
  className?: string;
}

function LanguageSwitcher({
  locale,
  onChange,
  cookieName = "NEXT_LOCALE",
  cookieMaxAge = 60 * 60 * 24 * 365,
  options = DEFAULT_LOCALES,
  ariaLabel = "Choisir la langue",
  className,
}: LanguageSwitcherProps) {
  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      if (typeof document !== "undefined") {
        // Path=/ so the cookie applies site-wide; SameSite=Lax is the
        // next-intl documented default for locale cookies.
        document.cookie = `${cookieName}=${encodeURIComponent(
          value,
        )}; Max-Age=${cookieMaxAge}; Path=/; SameSite=Lax`;
      }
      onChange?.(value);
    },
    [cookieName, cookieMaxAge, onChange],
  );

  return (
    <label
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground",
        className,
      )}
    >
      <Globe className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{ariaLabel}</span>
      <select
        value={locale}
        onChange={handleChange}
        aria-label={ariaLabel}
        className="bg-transparent text-xs font-medium uppercase focus:outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.shortCode ?? opt.value.toUpperCase()}
          </option>
        ))}
      </select>
    </label>
  );
}

LanguageSwitcher.displayName = "LanguageSwitcher";

export { LanguageSwitcher };
