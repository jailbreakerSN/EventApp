/**
 * Map a next-intl locale code to its BCP-47 regional variant used by
 * `Intl.DateTimeFormat` / `Intl.NumberFormat` for Senegal-anchored formatting.
 *
 * Kept as a pure function so it works in server components, client components,
 * and middleware alike.
 */
export function intlLocale(locale: string): string {
  switch (locale) {
    case "fr":
      return "fr-SN";
    case "en":
      return "en-SN";
    case "wo":
      return "wo-SN";
    default:
      return locale;
  }
}
