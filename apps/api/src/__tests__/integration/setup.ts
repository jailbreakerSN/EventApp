/**
 * Global setup for emulator-driven integration tests.
 *
 * Loaded before every integration test file via `vitest.integration.config.ts`.
 * Must run before any module that imports `firebase-admin/firestore`, which is
 * why it lives in `setupFiles` rather than inline helpers — vitest guarantees
 * setupFiles execute before test modules are evaluated.
 */

// ── Firestore emulator routing ──────────────────────────────────────────────
// When this env var is set, firebase-admin auto-routes all RPCs to the
// emulator (no credentials required). The host defaults to the value
// `firebase emulators:start` prints; it can be overridden in CI.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
}
// Firebase Auth emulator — required for service paths that call
// `auth.setCustomUserClaims`, `auth.getUser`, etc. (invite accept, admin
// role updates, organization membership transitions). Without this,
// firebase-admin tries to reach the real Firebase Auth API and fails on
// missing credentials.
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
}

// Deterministic project id — the emulator keeps state per project.
// Match the seed script's default so ad-hoc debugging against the same
// emulator sees the same documents.
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "teranga-integration-test";
process.env.FIREBASE_STORAGE_BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET ?? "teranga-integration-test.appspot.com";
process.env.GOOGLE_APPLICATION_CREDENTIALS = "";

// Minimum env vars needed by `src/config/index.ts` validation.
// NB: the config accepts "development" | "staging" | "production" only —
// anything else (including "test", which CI often exports) makes it
// `process.exit(1)` on import. Force development here.
process.env.NODE_ENV = "development";
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? "http://localhost:3000";
process.env.QR_SECRET = process.env.QR_SECRET ?? "integration-qr-secret-minimum-32-chars-long-ok";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";
