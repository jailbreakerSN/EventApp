import { Resend } from "resend";
import { defineSecret } from "firebase-functions/params";

// Secrets pulled from Google Secret Manager at function cold-start.
// Must be bound to each function via the `secrets: [...]` option so the
// runtime injects the value — referencing `.value()` outside a bound
// function throws at runtime.
//
// Bootstrap expectation:
//   - RESEND_API_KEY is set manually before the first deploy:
//       firebase functions:secrets:set RESEND_API_KEY
//   - RESEND_WEBHOOK_SECRET starts as a placeholder; the
//     bootstrapResendInfra callable writes the real value as a new
//     version once Resend returns the signing_secret. Next cold-start
//     picks up the new value automatically — no redeploy needed.
export const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
export const RESEND_WEBHOOK_SECRET = defineSecret("RESEND_WEBHOOK_SECRET");

let sdk: Resend | null = null;

/**
 * Lazily-constructed Resend SDK client. Cached per function instance so we
 * don't pay the constructor cost on every invocation. Invalidated naturally
 * when the instance cold-starts (which is when a new secret version would
 * land anyway).
 */
export function getResend(): Resend {
  if (!sdk) {
    sdk = new Resend(RESEND_API_KEY.value());
  }
  return sdk;
}

// Exported for tests only — lets them swap the cached instance.
export function __resetResendForTests(): void {
  sdk = null;
}
