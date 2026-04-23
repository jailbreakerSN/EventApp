#!/usr/bin/env node
/**
 * Post-deploy smoke probe — hits the admin endpoints that need composite
 * indexes and validation contracts to work correctly.
 *
 * Why: the static audit (`scripts/audit-firestore-indexes.ts`) catches
 * primary index-coverage gaps at PR time, but it cannot see two classes
 * of staging bug that have both landed recently:
 *
 *   1. Firestore composite-index "subset" shapes (single-filter queries
 *      that need a dedicated 2-field composite). These are warnings in
 *      the audit, not blocking — so a UI-triggered single-filter query
 *      can 500 against the REAL Firestore while the emulator cheerfully
 *      returns results.
 *   2. Zod validation contracts between the admin UI (date-only input)
 *      and the API (full ISO datetime). These show up as 400s.
 *
 * This probe runs AFTER the staging deploy, authenticates as the seeded
 * super-admin, and hits every admin endpoint + filter combo the backoffice
 * can trigger. A non-2xx response fails the job and the workflow files
 * an incident issue (existing machinery in deploy-staging.yml).
 *
 * The probe is deliberately:
 *   - bounded: ~15 requests, <10s total.
 *   - idempotent: all GETs, no mutations.
 *   - auth-aware: signs in with a stable seeded persona. Sign-in failure
 *     means the seed didn't run — itself a deploy-blocker.
 *   - robust: retries per request (cold-start + propagation tolerance).
 *
 * Usage:
 *   API_URL=https://... FIREBASE_API_KEY=... \
 *     node scripts/smoke-probe-admin.mjs
 *
 * Exit codes:
 *   0 — every probe returned 2xx
 *   1 — sign-in failed, or at least one probe failed after retries
 */

const API_URL = process.env.API_URL;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@teranga.dev";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "password123";

if (!API_URL || !FIREBASE_API_KEY) {
  console.error("Usage: API_URL=... FIREBASE_API_KEY=... node scripts/smoke-probe-admin.mjs");
  process.exit(1);
}

// ── Sign in as the seeded super-admin ──────────────────────────────────────

async function signIn() {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      returnSecureToken: true,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`::error::Sign-in failed (HTTP ${res.status}): ${err}`);
    console.error(
      "::error::The seeded super-admin persona might be missing. Check the seed-staging job.",
    );
    process.exit(1);
  }
  const data = await res.json();
  console.log(`✓ Signed in as ${ADMIN_EMAIL} (uid=${data.localId})`);
  return data.idToken;
}

// ── Probe a single URL with retries ────────────────────────────────────────

async function probe(token, label, path, expectedCode = 200) {
  const url = `${API_URL}${path}`;
  let lastCode = "000";
  let lastBody = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        // 20s per attempt is enough for Cloud Run cold starts.
        signal: AbortSignal.timeout(20_000),
      });
      lastCode = String(res.status);
      if (res.status === expectedCode) {
        console.log(`::notice::${label} OK (${res.status}) attempt=${attempt}`);
        return true;
      }
      // Capture the first 200 chars of the error body so the CI log tells
      // an operator WHY the endpoint failed (missing index, bad validation,
      // auth propagation, etc) without needing to re-run locally.
      lastBody = (await res.text()).slice(0, 200);
      console.log(
        `::warning::${label} attempt ${attempt} returned ${res.status}, body=${lastBody}`,
      );
    } catch (err) {
      lastCode = `error:${err?.code ?? err?.message ?? "unknown"}`;
      console.log(`::warning::${label} attempt ${attempt} threw ${lastCode}`);
    }
    // Exponential backoff before retry.
    await new Promise((r) => setTimeout(r, attempt * 3_000));
  }
  console.log(`::error::${label} FAILED — last=${lastCode} body=${lastBody} url=${url}`);
  return false;
}

// ── URL list ───────────────────────────────────────────────────────────────
// Covers every filter surface a super-admin can trigger from the backoffice.
// Each entry corresponds to a specific UI action: a role filter click, a
// status toggle, a date range picker, etc. Adding a new filter to the admin
// UI = add one line here.

const PROBES = [
  // /admin/users filters — the staging 500 class we just fixed.
  ["admin/users (no filter)", "/v1/admin/users?page=1&limit=20"],
  ["admin/users role=organizer", "/v1/admin/users?role=organizer&page=1&limit=20"],
  ["admin/users role=participant", "/v1/admin/users?role=participant&page=1&limit=20"],
  ["admin/users role=staff", "/v1/admin/users?role=staff&page=1&limit=20"],
  ["admin/users isActive=true", "/v1/admin/users?isActive=true&page=1&limit=20"],
  [
    "admin/users role+isActive",
    "/v1/admin/users?role=organizer&isActive=true&page=1&limit=20",
  ],
  // /admin/organizations filters — 4-field maximal is declared now.
  ["admin/organizations (no filter)", "/v1/admin/organizations?page=1&limit=20"],
  ["admin/organizations plan=pro", "/v1/admin/organizations?plan=pro&page=1&limit=20"],
  [
    "admin/organizations isVerified=true",
    "/v1/admin/organizations?isVerified=true&page=1&limit=20",
  ],
  // /admin/audit-logs filters — include the single-action subset and the
  // date-range coercion path that both 500'd / 400'd yesterday.
  ["admin/audit-logs (no filter)", "/v1/admin/audit-logs?page=1&limit=20"],
  [
    "admin/audit-logs action=event.created",
    "/v1/admin/audit-logs?action=event.created&page=1&limit=20",
  ],
  [
    "admin/audit-logs actorId",
    "/v1/admin/audit-logs?actorId=superadmin-uid-001&page=1&limit=20",
  ],
  [
    "admin/audit-logs resourceType=venue",
    "/v1/admin/audit-logs?resourceType=venue&page=1&limit=20",
  ],
  [
    "admin/audit-logs dateFrom+dateTo (date-only)",
    "/v1/admin/audit-logs?dateFrom=2026-04-20&dateTo=2026-04-24&page=1&limit=20",
  ],
  // /admin/events filter — covered by the maximal auditLogs + events indexes.
  ["admin/events status=published", "/v1/admin/events?status=published&page=1&limit=20"],

  // ── Caller-controlled orderBy shapes ───────────────────────────────
  // The admin venues page hits GET /v1/venues which runs
  // venueRepository.findApproved with orderBy defaulted by
  // VenueQuerySchema to "name" ASC. The static audit cannot resolve
  // `orderBy: query.orderBy` (no literal fallback) so this endpoint
  // is now checked at deploy-time. One probe per default case is
  // enough — other orderBy values use indexes emitted by the same
  // deploy's firestore.indexes.json and would fail the same way.
  //
  // Add a similar line whenever a new service introduces
  // `orderBy: <var>.orderBy` — the audit warns at PR time, this probe
  // catches it at deploy time.
  ["public/venues default orderBy=name", "/v1/venues?page=1&limit=20"],
  ["public/venues orderBy=createdAt desc", "/v1/venues?orderBy=createdAt&orderDir=desc&page=1&limit=20"],
  ["public/venues orderBy=eventCount desc", "/v1/venues?orderBy=eventCount&orderDir=desc&page=1&limit=20"],
];

// ── Run ────────────────────────────────────────────────────────────────────

const token = await signIn();

let failed = 0;
for (const [label, path] of PROBES) {
  const ok = await probe(token, label, path);
  if (!ok) failed++;
}

console.log("");
console.log(`─── Admin smoke probe summary ───────────────────────────────`);
console.log(`Total: ${PROBES.length} — passed: ${PROBES.length - failed}, failed: ${failed}`);

if (failed > 0) {
  console.log(
    `::error::${failed} admin endpoint(s) failed after retries. This usually means a missing Firestore composite index (500) or a Zod validation contract mismatch (400). Check the logs above for the exact URL and body.`,
  );
  process.exit(1);
}
console.log("✓ All admin endpoints healthy.");
process.exit(0);
