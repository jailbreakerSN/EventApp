/**
 * Common Zod primitives shared across the rest of the schema modules.
 *
 * Currently a single export — `IsoDateTimeSchema` — that codifies the
 * timestamp convention from ADR-0009. Per-file `z.string().datetime()`
 * literals were the established pattern for ~170 occurrences across
 * `packages/shared-types/src/*.types.ts` before this file existed; that
 * convention is still acceptable and not being deprecated. New code
 * SHOULD prefer `IsoDateTimeSchema` so a future schema change (e.g.
 * tightening to `.datetime({ offset: true })`) is a one-line edit
 * rather than a 170-call codemod.
 */

import { z } from "zod";

/**
 * ISO 8601 date-time string (the platform-wide timestamp format).
 *
 * Valid examples:
 *   - `"2026-04-25T18:23:01.123Z"`
 *   - `"2026-04-25T18:23:01Z"`
 *
 * Invalid examples:
 *   - `"2026-04-25"` (date only — use a separate `IsoDateSchema` if needed)
 *   - `"2026/04/25 18:23:01"` (wrong separators)
 *   - Firestore `Timestamp` objects (those are converted at the API
 *     boundary; persistence stays in ISO strings — see ADR-0009).
 */
export const IsoDateTimeSchema = z.string().datetime();

/** Inferred type — equivalent to `string` but documents intent. */
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;
