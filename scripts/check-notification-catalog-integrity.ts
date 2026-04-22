#!/usr/bin/env tsx
/**
 * Notification catalog integrity check (CI guard).
 *
 * Fails the build when the declarative catalog in
 * packages/shared-types/src/notification-catalog.ts drifts from the code:
 *
 *   1. A catalog entry lists `email` in defaultChannels but has no
 *      templates.email id — or the id doesn't resolve to a .tsx file
 *      (or exported builder) under apps/api/src/services/email/templates/.
 *   2. A catalog entry's triggerDomainEvent has NEITHER an eventBus.emit
 *      caller in services/ NOR a listener in events/listeners/. That
 *      catches design-only entries that would silently no-op in prod.
 *   3. A catalog entry has defaultChannels not a subset of
 *      supportedChannels. Zod's `assertCatalogIntegrity()` already
 *      enforces this at import, but we double-check here so CI surfaces
 *      a friendly message rather than a Zod TypeError.
 *
 * Exits non-zero on any violation. Otherwise prints "OK: notification
 * catalog integrity check passed" and exits 0.
 *
 * Run: `npm run notifications:check`
 */
import { computeViolations, scanAll } from "./lib/notification-catalog-scan";

function main(): void {
  const scan = scanAll();
  const violations = computeViolations(scan);

  if (violations.length === 0) {
    process.stdout.write("OK: notification catalog integrity check passed\n");
    process.exit(0);
  }

  process.stderr.write(
    `FAIL: notification catalog has ${violations.length} integrity violation(s):\n\n`,
  );

  // Group by key so the operator sees one bullet list per catalog entry.
  const byKey = new Map<string, typeof violations>();
  for (const v of violations) {
    const list = byKey.get(v.key) ?? [];
    list.push(v);
    byKey.set(v.key, list);
  }

  for (const [key, vs] of byKey.entries()) {
    process.stderr.write(`  • ${key}\n`);
    for (const v of vs) {
      process.stderr.write(`      - [${v.reason}] ${v.message}\n`);
    }
  }

  process.stderr.write(
    "\nRegenerate the truth table with `npm run notifications:status` to see the full coverage map.\n",
  );
  process.exit(1);
}

main();
