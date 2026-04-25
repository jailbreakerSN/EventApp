/**
 * Seed coverage scanning helpers.
 *
 * Shared between:
 *   - scripts/generate-seed-coverage-status.ts (the Markdown report
 *     generator — produces docs/seed/coverage-status.md).
 *   - scripts/check-seed-coverage.ts (the CI guard that exits non-zero
 *     when the seed scripts drift from the canonical collection list).
 *
 * Intentionally dependency-light: uses only Node's built-in fs / path
 * modules. Scanning is regex-based because the cost of a full TypeScript
 * AST parse far exceeds the value for a single-pattern extract
 * (`db.collection("XXX")` / `.collection(COLLECTIONS.XXX)` call sites
 * inside the seed/reset scripts).
 *
 * The three sources of truth this reconciles are:
 *
 *   1. COLLECTIONS in apps/api/src/config/firebase.ts — every Firestore
 *      collection the platform is allowed to touch.
 *   2. RESETTABLE_COLLECTIONS in scripts/seed/config.ts — the ordered
 *      list of collections the reset command wipes before re-seeding.
 *   3. The seed scripts themselves (scripts/seed/**.ts, seed-emulators.ts,
 *      seed-plans.ts, seed-qa-fixtures.ts) — every collection that gets
 *      example data written for local / staging QA.
 *
 * Drift between (1) and (2) = fresh staging is left with stale docs in
 * collections the reset script doesn't know about. Drift between (1) and
 * (3) = new features ship without seed examples, so QA can't exercise
 * them. Waivers in SEED_COVERAGE_WAIVER below capture the legitimate
 * runtime-only or operator-only exceptions.
 */
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Paths ─────────────────────────────────────────────────────────────────

/** Repository root. Derived from this file's location so the script works
 *  regardless of cwd (tsx may be invoked from any directory). */
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

export const FIREBASE_CONFIG_FILE = path.join(
  REPO_ROOT,
  "apps/api/src/config/firebase.ts",
);
export const SEED_CONFIG_FILE = path.join(REPO_ROOT, "scripts/seed/config.ts");

/**
 * Every .ts file in `scripts/` we consider a potential seed writer. The
 * check explicitly ignores library helpers (`scripts/lib/`) and sibling
 * utilities that aren't seeders (e.g. `audit-firestore-indexes.ts`,
 * `backfill-*.ts`, `check-*.ts`, `generate-*.ts`, `validate-*.ts`).
 *
 * Extend SEED_SCRIPT_FILES below when new seed scripts land.
 */
export const SEED_SCRIPT_FILES: string[] = [
  path.join(REPO_ROOT, "scripts/seed-emulators.ts"),
  path.join(REPO_ROOT, "scripts/seed-plans.ts"),
  path.join(REPO_ROOT, "scripts/seed-qa-fixtures.ts"),
  path.join(REPO_ROOT, "scripts/seed-reset.ts"),
  path.join(REPO_ROOT, "scripts/seed/01-organizations.ts"),
  path.join(REPO_ROOT, "scripts/seed/02-users.ts"),
  path.join(REPO_ROOT, "scripts/seed/03-venues.ts"),
  path.join(REPO_ROOT, "scripts/seed/04-events.ts"),
  path.join(REPO_ROOT, "scripts/seed/05-activity.ts"),
  path.join(REPO_ROOT, "scripts/seed/06-social.ts"),
  path.join(REPO_ROOT, "scripts/seed/config.ts"),
];

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SeedCoverageEntry {
  /** Firestore collection name (e.g. "notificationDispatchLog"). */
  collectionName: string;
  /** COLLECTIONS constant key (e.g. "NOTIFICATION_DISPATCH_LOG"), or null
   *  if the collection only appears in the reset list or in seed writers
   *  without a matching COLLECTIONS entry. */
  collectionConstKey: string | null;
  /** Whether this collection is wiped by the reset command. */
  inResettableList: boolean;
  /** Repo-relative paths of seed scripts that write to this collection. */
  seedWriterFiles: string[];
  /** Waived via SEED_COVERAGE_WAIVER — reason surfaced in the report. */
  hasAuditWaiver: boolean;
  waiverReason?: string;
}

// ─── Waivers ───────────────────────────────────────────────────────────────

/**
 * Collections that legitimately do NOT need a seed writer and/or are NOT
 * in the reset list. Waiving keeps the CI exit code green while the
 * Markdown report still surfaces them in the "Waived" section so drift
 * decisions stay visible.
 *
 * New entries MUST include a one-line rationale and a pointer to the
 * owning subsystem so a future reader can re-evaluate the waiver.
 */
export const SEED_COVERAGE_WAIVER: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  [
    "plans",
    "System plan catalog (free/starter/pro/enterprise) — seeded idempotently by seed-plans.ts and intentionally preserved across resets so orgs never point at a missing plan mid-reset.",
  ],
  [
    "offlineSync",
    "Transient per-device sync state written by the mobile client at runtime. No canonical seed shape — exercising it requires a real device round-trip.",
  ],
  [
    "notificationDispatchLog",
    "Append-only runtime audit of notification deliveries. Populated by the dispatcher; no seed fixtures needed.",
  ],
  [
    "notificationSettingsHistory",
    "Append-only edit history for notificationSettings. Populated by the admin PUT flow; seed data would be synthetic noise.",
  ],
  [
    "alerts",
    "Cloud Monitoring bounce-rate alert docs mirrored into Firestore by the scheduled Cloud Function. Runtime-only.",
  ],
  [
    "refundLocks",
    "In-flight refund serialisation locks — created and released inside the refund transaction. Never seeded directly.",
  ],
  [
    "checkinLocks",
    "Uniqueness-enforcement locks written transactionally by the scan path. Never seeded directly.",
  ],
  [
    "emailSuppressions",
    "Resend webhook bounce/complaint output. Populated by the resendWebhook Cloud Function; seed data would contaminate the suppression list.",
  ],
  [
    "smsLog",
    "Runtime SMS dispatch log. Append-only; no seed fixtures.",
  ],
  [
    "emailLog",
    "Runtime email dispatch log. Append-only; no seed fixtures.",
  ],
  [
    "checkinFeed",
    "Already seeded today in 06-social.ts, but waived here so the collection can be demoted back to runtime-only without breaking CI if the QA fixture is ever removed.",
  ],
  [
    "rateLimitBuckets",
    "Runtime-written rate-limit buckets — transient; populated by rateLimit() only when endpoints fire.",
  ],
  [
    "impersonationCodes",
    "Transient auth-code flow for super-admin impersonation — 60 s TTL, server-only writes via ImpersonationCodeService. Seed fixtures would be stale within a minute and have no QA value; security properties are exercised via integration tests, not seed data.",
  ],
  [
    "adminJobLocks",
    "Single-flight locks for the admin job runner (T2.2). One doc per jobKey, held only while a handler is running (≤ 5 min) and deleted on completion. Transient operational state — seeding would either block the first real trigger or fill the collection with zombie locks. Reset behaviour is implicit (any run deletes its own lock; stale locks self-reclaim).",
  ],
  [
    "webhookEvents",
    "Runtime-received payment-provider webhooks (T2.1). Populated only when a provider actually calls /v1/payments/webhook/:provider. Seeding synthetic rows would either look like real deliveries in the admin console (misleading operators) or trigger replay attempts against non-existent payments (noise in the audit trail). Purely operational log.",
  ],
  [
    "apiKeys",
    "T2.3 — organization-scoped API keys. Stored as SHA-256 hashes only; plaintext returned exactly once at issuance and never persisted. Seeding would write hashes whose plaintexts nobody holds, producing 'valid-looking but unusable' rows forever — confusing for QA and pointless for integration tests (which mint keys through the service API anyway).",
  ],
  [
    "scheduledAdminOps",
    "Sprint-4 T3.2 — operator-defined cron schedules that bind a registered admin job key, JSON input, cron expression, and timezone. Created exclusively from the back-office (super-admin) and dispatched out-of-process by a Cloud Functions scheduled trigger. Seeding synthetic rows would either fire bogus jobs against the dev environment on every emulator restart or sit perpetually paused — both confusing for QA. Rules deny all client writes (Admin SDK only).",
  ],
  [
    "firestoreUsage",
    "Sprint-4 T3.3 — per-org per-day Firestore read counters flushed by the AsyncLocalStorage middleware. Pure runtime telemetry. Seeding would either inflate the cost dashboard with synthetic numbers (misleading operators) or zero on every reset (defeating the rolling-window view). Append/increment-only; rules deny all client writes (Admin SDK only).",
  ],
]);

// ─── COLLECTIONS constant parsing ──────────────────────────────────────────

/**
 * Parse apps/api/src/config/firebase.ts and extract every `KEY: "value"`
 * pair inside the `COLLECTIONS = { ... }` block. Comments (both `//` and
 * `/* ... *\/`) are stripped before matching so inline documentation
 * doesn't interfere.
 *
 * Returns a Map keyed by the constant name (e.g. "NOTIFICATION_DISPATCH_LOG")
 * with the Firestore collection name as the value (e.g.
 * "notificationDispatchLog"). Preserves declaration order.
 */
export function scanCollectionsConstant(): Map<string, string> {
  const source = fs.readFileSync(FIREBASE_CONFIG_FILE, "utf8");

  // Locate the `export const COLLECTIONS = { ... } as const;` block.
  const startMatch = /export\s+const\s+COLLECTIONS\s*=\s*\{/.exec(source);
  if (!startMatch) {
    throw new Error(
      `Could not locate \`export const COLLECTIONS = { ... }\` in ${FIREBASE_CONFIG_FILE}`,
    );
  }

  // Find the matching closing brace by tracking nesting depth. `as const`
  // follows the closing brace so we don't need to handle it specially.
  const openIndex = startMatch.index + startMatch[0].length - 1;
  let depth = 0;
  let closeIndex = -1;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        closeIndex = i;
        break;
      }
    }
  }
  if (closeIndex === -1) {
    throw new Error(
      `Unterminated COLLECTIONS block in ${FIREBASE_CONFIG_FILE}`,
    );
  }

  const body = source.slice(openIndex + 1, closeIndex);

  // Strip block comments, then line comments. Done in this order so block
  // comments containing `//` sequences don't confuse the line-comment pass.
  const stripped = body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  const out = new Map<string, string>();
  // Match KEY: "value"  — KEY must be all-caps-snake by convention.
  const entryRegex = /([A-Z][A-Z0-9_]*)\s*:\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(stripped)) !== null) {
    const [, key, value] = match;
    if (key && value && !out.has(key)) {
      out.set(key, value);
    }
  }
  return out;
}

// ─── RESETTABLE_COLLECTIONS parsing ────────────────────────────────────────

/**
 * Parse scripts/seed/config.ts and return the set of collection names in
 * the RESETTABLE_COLLECTIONS array. Comments are stripped before matching
 * so the many inline explanations don't pollute the result.
 */
export function scanResettableList(): Set<string> {
  const source = fs.readFileSync(SEED_CONFIG_FILE, "utf8");

  const startMatch = /export\s+const\s+RESETTABLE_COLLECTIONS\s*=\s*\[/.exec(
    source,
  );
  if (!startMatch) {
    throw new Error(
      `Could not locate \`export const RESETTABLE_COLLECTIONS = [ ... ]\` in ${SEED_CONFIG_FILE}`,
    );
  }

  const openIndex = startMatch.index + startMatch[0].length - 1;
  let depth = 0;
  let closeIndex = -1;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        closeIndex = i;
        break;
      }
    }
  }
  if (closeIndex === -1) {
    throw new Error(
      `Unterminated RESETTABLE_COLLECTIONS block in ${SEED_CONFIG_FILE}`,
    );
  }

  const body = source.slice(openIndex + 1, closeIndex);
  const stripped = body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  const out = new Set<string>();
  const entryRegex = /["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(stripped)) !== null) {
    const [, value] = match;
    if (value) out.add(value);
  }
  return out;
}

// ─── Seed writer scanning ──────────────────────────────────────────────────

/**
 * Scan every seed script for `.collection(...)` calls and return a map
 * from collection name → list of writer files (repo-relative).
 *
 * Handles three forms:
 *   1. `.collection("literalName")`
 *   2. `db.collection("literalName")`
 *   3. `.collection(COLLECTIONS.CONST_KEY)` — resolved via the supplied
 *      COLLECTIONS map so rename-safe seeds also get credited.
 *
 * Files that don't exist on disk are skipped silently so this helper
 * stays usable from partial checkouts.
 */
export function scanSeedWriters(
  collectionsMap: Map<string, string>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();

  const literalRegex = /\.collection\(\s*["']([^"']+)["']/g;
  const constRegex = /\.collection\(\s*COLLECTIONS\.([A-Z][A-Z0-9_]*)/g;

  for (const file of SEED_SCRIPT_FILES) {
    if (!fs.existsSync(file)) continue;
    const rel = path.relative(REPO_ROOT, file);
    const source = fs.readFileSync(file, "utf8");

    const record = (name: string) => {
      // Skip the RESETTABLE_COLLECTIONS declaration in scripts/seed/config.ts
      // and the COLLECTIONS declaration itself — neither writes to
      // Firestore, they just list names. `.collection(` never appears in
      // those blocks, so we don't need extra filtering here.
      const list = out.get(name) ?? [];
      if (!list.includes(rel)) list.push(rel);
      out.set(name, list);
    };

    let match: RegExpExecArray | null;

    literalRegex.lastIndex = 0;
    while ((match = literalRegex.exec(source)) !== null) {
      record(match[1]!);
    }

    constRegex.lastIndex = 0;
    while ((match = constRegex.exec(source)) !== null) {
      const constKey = match[1]!;
      const resolved = collectionsMap.get(constKey);
      if (resolved) record(resolved);
    }
  }

  return out;
}

// ─── Aggregate ─────────────────────────────────────────────────────────────

/**
 * Compute the full coverage matrix. The returned list is sorted by
 * collection name so the report is stable across runs (Map iteration
 * order is insertion order, which would otherwise change with
 * declaration-order edits to COLLECTIONS).
 */
export function computeCoverage(): SeedCoverageEntry[] {
  const collectionsMap = scanCollectionsConstant();
  const resettable = scanResettableList();
  const writers = scanSeedWriters(collectionsMap);

  // Invert CONST_KEY → name so we can annotate "name-only" entries (a
  // collection that appears in reset or writers but not in COLLECTIONS).
  const nameToConstKey = new Map<string, string>();
  for (const [key, value] of collectionsMap.entries()) {
    if (!nameToConstKey.has(value)) nameToConstKey.set(value, key);
  }

  // Union every collection name we know about from any of the three
  // sources. This is what we iterate to build the report.
  const allNames = new Set<string>();
  for (const name of collectionsMap.values()) allNames.add(name);
  for (const name of resettable) allNames.add(name);
  for (const name of writers.keys()) allNames.add(name);

  const entries: SeedCoverageEntry[] = [];
  for (const name of allNames) {
    const waiverReason = SEED_COVERAGE_WAIVER.get(name);
    entries.push({
      collectionName: name,
      collectionConstKey: nameToConstKey.get(name) ?? null,
      inResettableList: resettable.has(name),
      seedWriterFiles: (writers.get(name) ?? []).slice().sort(),
      hasAuditWaiver: waiverReason !== undefined,
      waiverReason,
    });
  }

  entries.sort((a, b) => a.collectionName.localeCompare(b.collectionName));
  return entries;
}

// ─── Integrity checks ──────────────────────────────────────────────────────

/**
 * Compute every integrity violation for the given coverage entries. The
 * CI guard (`check-seed-coverage.ts`) exits non-zero when this returns a
 * non-empty list; the report generator surfaces the same list.
 *
 * Rules:
 *
 *   1. A collection listed in COLLECTIONS that is NOT in
 *      RESETTABLE_COLLECTIONS AND NOT in SEED_COVERAGE_WAIVER — the reset
 *      command would leave stale data behind.
 *
 *   2. A collection listed in RESETTABLE_COLLECTIONS that is NOT in
 *      COLLECTIONS — dead reset entry pointing at a renamed or removed
 *      collection.
 */
export function computeViolations(entries: SeedCoverageEntry[]): string[] {
  const violations: string[] = [];

  for (const entry of entries) {
    const inCollectionsConstant = entry.collectionConstKey !== null;

    // Rule 1 — missing reset coverage (and not waived).
    if (inCollectionsConstant && !entry.inResettableList && !entry.hasAuditWaiver) {
      violations.push(
        `Collection \`${entry.collectionName}\` (COLLECTIONS.${entry.collectionConstKey}) is not in RESETTABLE_COLLECTIONS and has no waiver. ` +
          `Fix: add it to RESETTABLE_COLLECTIONS in scripts/seed/config.ts (preferred) OR add a waiver entry in SEED_COVERAGE_WAIVER in scripts/lib/seed-coverage-scan.ts with a short rationale.`,
      );
    }

    // Rule 2 — dead reset entry. Waived collections are allowed to be in
    // the reset list without a COLLECTIONS entry: by definition they are
    // runtime-only documents (e.g. the bounce-rate scheduled function's
    // `alerts` mirror) that we still want cleared in a staging reset.
    if (!inCollectionsConstant && entry.inResettableList && !entry.hasAuditWaiver) {
      violations.push(
        `Collection \`${entry.collectionName}\` is in RESETTABLE_COLLECTIONS but not in COLLECTIONS (apps/api/src/config/firebase.ts). ` +
          `Fix: either re-add the collection to COLLECTIONS or drop it from RESETTABLE_COLLECTIONS (likely a rename/merge that was half-applied).`,
      );
    }
  }

  return violations;
}
