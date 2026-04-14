import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

// ─── next-intl request configuration ────────────────────────────────────────
// Single-locale setup (no URL-based routing). Default is French — language
// switching is driven by a cookie set via the <LanguageSwitcher> UI.
//
// Supported locales:
//   - fr (default — Senegal / francophone West Africa)
//   - en (secondary — diaspora + international participants)
//   - wo (Wolof — key files wired; long-tail translations in progress)

export type SupportedLocale = "fr" | "en" | "wo";

export const defaultLocale: SupportedLocale = "fr";
export const supportedLocales: SupportedLocale[] = ["fr", "en", "wo"];

export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isSupportedLocale(value: string | undefined): value is SupportedLocale {
  return !!value && (supportedLocales as string[]).includes(value);
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale: SupportedLocale = isSupportedLocale(raw) ? raw : defaultLocale;

  let messages: Record<string, unknown>;
  try {
    messages = (await import(`./messages/${locale}.json`)).default;
  } catch {
    // Locale file missing (e.g. partial wo.json coverage) — fall back to French.
    messages = (await import(`./messages/${defaultLocale}.json`)).default;
  }

  return {
    locale,
    messages,
  };
});
