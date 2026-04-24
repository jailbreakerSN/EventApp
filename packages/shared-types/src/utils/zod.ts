import { z } from "zod";

/**
 * Coerces query-string booleans correctly: `"true"` → `true`, `"false"` → `false`.
 *
 * Why not `z.coerce.boolean()`?
 * Zod's coerce wraps `Boolean()`, which makes `Boolean("false") === true`
 * because every non-empty string is truthy in JavaScript. That silently
 * inverts every `?flag=false` URL — the failure mode that broke
 * `/admin/organizations?isVerified=false` and the audit found across
 * five admin filter schemas (see review 2026-04-24).
 *
 * Other accepted shapes mirror common URL serialisations: `"1"` / `"0"`,
 * `"yes"` / `"no"`. Anything else falls through and Zod rejects it,
 * so a typo in a query string surfaces as a validation error rather
 * than a silently-wrong filter.
 */
export const zStringBoolean = () =>
  z.preprocess((v) => {
    if (typeof v === "boolean") return v;
    if (v === "true" || v === "1" || v === "yes") return true;
    if (v === "false" || v === "0" || v === "no") return false;
    return v;
  }, z.boolean());
