/**
 * Global test setup for the API.
 *
 * This file is loaded before every test file via vitest.config.ts setupFiles.
 * It sets environment variables needed by the config module.
 */

// Set required env vars before any module loads
process.env.FIREBASE_PROJECT_ID = "teranga-test";
process.env.FIREBASE_STORAGE_BUCKET = "teranga-test.appspot.com";
process.env.CORS_ORIGINS = "http://localhost:3000";
process.env.QR_SECRET = "test-qr-secret-min-16-chars";
process.env.NODE_ENV = "development";
