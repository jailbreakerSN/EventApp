import { getRequestConfig } from "next-intl/server";

// ─── next-intl request configuration ────────────────────────────────────────
// Uses a single-locale setup (no URL-based routing) since we default to French
// and support language switching via user preference, not URL segments.
//
// Supported locales: fr (default), en, wo (Wolof — future)

export type SupportedLocale = "fr" | "en";

export const defaultLocale: SupportedLocale = "fr";
export const supportedLocales: SupportedLocale[] = ["fr", "en"];

export default getRequestConfig(async () => {
  // For now, always use French. In the future, this can read from:
  // - User profile preference (stored in Firestore)
  // - Cookie (set by language switcher)
  // - Accept-Language header
  const locale: SupportedLocale = defaultLocale;

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
