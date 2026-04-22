#!/usr/bin/env tsx
/**
 * Seed-data coverage integrity check (CI guard).
 *
 * Fails the build when the seed scripts / reset list drift from the
 * canonical Firestore collection list in
 * apps/api/src/config/firebase.ts → COLLECTIONS:
 *
 *   1. A collection listed in COLLECTIONS is NOT in
 *      RESETTABLE_COLLECTIONS (scripts/seed/config.ts) AND NOT waived
 *      via SEED_COVERAGE_WAIVER. In this case `seed-reset` would leave
 *      stale documents in the collection, so a "fresh staging" refresh
 *      is not actually fresh.
 *
 *   2. A collection is in RESETTABLE_COLLECTIONS but no longer exists
 *      in COLLECTIONS — dead entry from a rename/merge that was only
 *      half-applied.
 *
 * Exits non-zero on any violation. Otherwise prints "OK: seed-data
 * coverage check passed" and exits 0.
 *
 * Run: `npm run seed:check`
 */
import {
  computeCoverage,
  computeViolations,
} from "./lib/seed-coverage-scan";

function main(): void {
  const entries = computeCoverage();
  const violations = computeViolations(entries);

  // Side metrics printed alongside the pass/fail verdict. Useful in CI
  // logs to spot regressions trending the wrong way even when the check
  // itself stays green.
  const totalCollections = entries.filter((e) => e.collectionConstKey).length;
  const withWriter = entries.filter((e) => e.seedWriterFiles.length > 0).length;
  const waived = entries.filter((e) => e.hasAuditWaiver).length;
  const inResetOnly = entries.filter(
    (e) => e.inResettableList && e.seedWriterFiles.length === 0 && !e.hasAuditWaiver,
  ).length;

  if (violations.length === 0) {
    process.stdout.write(
      `OK: seed-data coverage check passed — ${totalCollections} collections, ${withWriter} with a seed writer, ${waived} waived, ${inResetOnly} reset-only.\n`,
    );
    process.exit(0);
  }

  process.stderr.write(
    `FAIL: seed-data coverage has ${violations.length} integrity violation(s):\n\n`,
  );

  for (const message of violations) {
    process.stderr.write(`  • ${message}\n`);
  }

  process.stderr.write(
    "\nRegenerate the truth table with `npm run seed:status` to see the full coverage map.\n",
  );
  process.exit(1);
}

main();
