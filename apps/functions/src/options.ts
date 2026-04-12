import { setGlobalOptions } from "firebase-functions/v2";

/**
 * Global defaults for every v2 Cloud Function in this codebase.
 *
 * **This file MUST be imported before any trigger module** — ES module imports
 * are hoisted and evaluated top-to-bottom, so `import "./options";` as the
 * first line of index.ts runs setGlobalOptions() before any trigger file's
 * top-level `onDocumentCreated(...)` call captures the runtime config.
 *
 * Individual triggers can still override these (e.g. the badge trigger bumps
 * memory to 512MiB for PDF generation). Note: this only affects v2 triggers.
 * v1 triggers (auth.triggers) must set `maxInstances` in their `.runWith()`.
 */
setGlobalOptions({
  region: "europe-west1",
  // Safety cap for dev/staging cost control: a buggy trigger that spirals
  // into an event loop (e.g. a Firestore write that re-fires itself) won't
  // be able to spin up more than 3 instances before hitting this ceiling.
  // Bump this before production — Firebase's default cap (~1000) is far too
  // generous for a staging project that pays per GB-second.
  maxInstances: 3,
});
