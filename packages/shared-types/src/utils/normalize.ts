/**
 * Accent-folded, case-insensitive normalisation for francophone search.
 *
 * Used identically on the client (filtering, autocomplete dedupe) and on the
 * server (writing `searchKeywords[]`, comparing to incoming `q`). Any divergence
 * between caller sites silently breaks search ("Sénégal" stops matching "senegal"),
 * so this function is the only sanctioned text comparator on the platform.
 *
 * See `docs/design-system/data-listing.md` § Frontend primitives.
 */
export function normalizeFr(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’ʼ']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokenise a normalised string into searchable words.
 *
 * Splits on any non-letter / non-digit character (Unicode-aware), drops tokens
 * shorter than 2 characters. Order is not preserved; duplicates are not removed
 * (callers wrap into Set when deduplication matters).
 */
export function tokenizeFr(input: string): string[] {
  return normalizeFr(input)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
}

/**
 * Build the `searchKeywords[]` field for a Firestore document.
 *
 * For every input token, emits every prefix of length 2..min(15, tokenLength).
 * Deduplicates via Set. Hard-caps at 200 entries to keep document size bounded
 * (Firestore array fields scale with document size).
 *
 * Pass weighted text fragments via `parts`; weight is currently informational
 * (callers may use it to bias which fields contribute first when the cap is
 * reached) but the helper preserves insertion order so high-weight parts win
 * when the cap truncates.
 */
export function buildSearchKeywords(
  parts: ReadonlyArray<{ weight: 1 | 2 | 3; text: string | undefined | null }>,
): string[] {
  const ordered = [...parts].sort((a, b) => b.weight - a.weight);
  const tokens = new Set<string>();
  for (const { text } of ordered) {
    if (!text) continue;
    for (const word of tokenizeFr(text)) {
      const max = Math.min(15, word.length);
      for (let len = 2; len <= max; len++) {
        tokens.add(word.slice(0, len));
        if (tokens.size >= 200) return [...tokens];
      }
    }
  }
  return [...tokens];
}
