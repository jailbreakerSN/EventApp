import { getRequestConfig } from "next-intl/server";

// ─── next-intl request configuration ────────────────────────────────────────
// Single-locale setup — French default, language switching via user preference.
// Supported: fr (default), en, wo (Wolof — future)

export type SupportedLocale = "fr" | "en";

export const defaultLocale: SupportedLocale = "fr";
export const supportedLocales: SupportedLocale[] = ["fr", "en"];

export default getRequestConfig(async () => {
  const locale: SupportedLocale = defaultLocale;

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
