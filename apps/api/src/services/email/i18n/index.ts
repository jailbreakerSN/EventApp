import { type Dictionary, type Locale } from "./dictionary";
import { fr } from "./fr";
import { en } from "./en";
import { wo } from "./wo";

export { type Dictionary, type Locale } from "./dictionary";

const DICTIONARIES: Record<Locale, Dictionary> = { fr, en, wo };

/**
 * Resolve the dictionary for a locale, falling back to French.
 * Accepts `undefined` / unknown strings because upstream callers often pass
 * `user.preferredLanguage` which may be missing on legacy docs.
 */
export function pickDict(locale?: Locale | string | null): Dictionary {
  if (locale === "en") return DICTIONARIES.en;
  if (locale === "wo") return DICTIONARIES.wo;
  return DICTIONARIES.fr;
}

/**
 * Narrow an unknown string to a supported locale, or return undefined so
 * the caller can decide on the default. Safer than casting when reading
 * Firestore docs that may not have been migrated yet.
 */
export function asLocale(value: unknown): Locale | undefined {
  return value === "fr" || value === "en" || value === "wo" ? value : undefined;
}
