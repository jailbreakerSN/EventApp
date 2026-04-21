// Global test setup for apps/functions.
// Loaded before every test file via vitest.config.ts setupFiles.

// The Functions runtime normally injects GCLOUD_PROJECT; tests default to
// the staging project id so the IS_PROD check in function-options.ts reads
// false (staging defaults: 128 MiB, minInstances 0). Individual tests can
// override by reassigning process.env.GCLOUD_PROJECT before importing the
// module under test.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT ?? "teranga-app-990a8";
