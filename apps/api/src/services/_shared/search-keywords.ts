import { buildSearchKeywords as buildKeywordsCore, normalizeFr, type Event } from "@teranga/shared-types";

/**
 * Per-resource search-keyword composition for the Teranga events catalog.
 *
 * The doctrine (`docs/design-system/data-listing.md` § Backend primitives)
 * locks which fields contribute to the index and at what weight. Keep this
 * helper aligned with the table in the doctrine — the audit script verifies
 * the symmetry between the doctrine and this implementation.
 */

type EventForKeywords = Pick<Event, "title" | "tags" | "location">;

export function buildEventSearchKeywords(event: EventForKeywords): string[] {
  const tagsBlob = event.tags?.length ? event.tags.join(" ") : undefined;
  return buildKeywordsCore([
    { weight: 3, text: event.title },
    { weight: 2, text: tagsBlob },
    { weight: 1, text: event.location?.city },
    { weight: 1, text: event.location?.country },
  ]);
}

/**
 * Pull the most selective token out of a free-text query for a Firestore
 * `array-contains` lookup against `searchKeywords[]`. Returns `null` when
 * the query has no usable token (empty, only stop-words shorter than 2
 * characters, etc.) — callers MUST treat null as "skip the keyword filter,
 * no `q` constraint applies".
 *
 * "Most selective" = longest token. We index prefixes of length 2..15, so a
 * 7-character token is more selective than a 3-character one and yields a
 * smaller candidate set on Firestore. Multi-token search is then refined
 * client-side within the page (acceptable: the page is bounded by `limit`).
 */
export function pickSearchToken(q: string | undefined): string | null {
  if (!q) return null;
  const tokens = normalizeFr(q)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return null;
  // Prefix index caps at 15 chars per token — clamp the needle to match.
  const longest = tokens.reduce((a, b) => (b.length > a.length ? b : a));
  return longest.slice(0, 15);
}
