/**
 * P1-18 (audit L3) — Boot-time assertion that paired payment-provider
 * secrets are either ALL-set or ALL-unset.
 *
 * Why this matters
 * ────────────────
 * The Wave provider's webhook verifier short-circuits to `false` when
 * `WAVE_API_SECRET` is an empty string. The previous shape pulled the
 * secret with `process.env.WAVE_API_SECRET ?? ""`, so a half-configured
 * Cloud Run revision (Wave **enabled** in the registry by virtue of
 * `WAVE_API_KEY` being set, but no secret) **silently rejected every
 * Wave webhook in production** — the only signal was a 403 / sigfail
 * spike on the dashboard, which often went unnoticed because Wave's
 * retry policy hides the failure for ~30 minutes.
 *
 * The same hazard exists for Orange Money:
 *   - `ORANGE_MONEY_CLIENT_ID` enables OM in the registry
 *   - `ORANGE_MONEY_CLIENT_SECRET` is needed for OAuth token fetch
 *   - `ORANGE_MONEY_MERCHANT_KEY` is needed for the initiate body
 *   - `ORANGE_MONEY_NOTIF_TOKEN` is needed for webhook verify
 *
 * Missing any of the four = OM webhooks silently fail. Same for
 * `PAYMENT_WEBHOOK_SECRET` in non-development environments.
 *
 * Contract
 * ────────
 * The assertion runs ONCE at boot (before `buildApp()` returns).
 *
 *   - If all required env vars for a provider are set → OK
 *   - If all required env vars for a provider are unset → OK
 *     (provider is disabled, registry falls back to mock or 404)
 *   - If a partial set is detected → throw with a clear message
 *     listing the missing vars. Process exits with code 1.
 *
 * Tests live in `assert-provider-secrets.test.ts`. The function is
 * pure on `process.env` so tests stub it directly without spinning
 * up the Fastify app.
 */

interface ProviderSecretGroup {
  /** Provider key (matches `PaymentMethod`). */
  provider: string;
  /** The "trigger" env var that registers the provider in `payment.service.ts`. */
  triggerVar: string;
  /** Companion vars that MUST be set when the trigger var is set. */
  requiredCompanions: string[];
  /** Optional notes appended to the error message for operator clarity. */
  hint?: string;
}

const GROUPS: ProviderSecretGroup[] = [
  {
    provider: "wave",
    triggerVar: "WAVE_API_KEY",
    requiredCompanions: ["WAVE_API_SECRET"],
    hint:
      "Wave webhooks need the secret to verify HMAC signatures — without it, every webhook silently 403s.",
  },
  {
    provider: "orange_money",
    triggerVar: "ORANGE_MONEY_CLIENT_ID",
    requiredCompanions: [
      "ORANGE_MONEY_CLIENT_SECRET",
      "ORANGE_MONEY_MERCHANT_KEY",
      "ORANGE_MONEY_NOTIF_TOKEN",
    ],
    hint:
      "OM needs the OAuth secret + merchant key to initiate, and the notif_token to verify webhooks.",
  },
];

export interface ProviderSecretAssertionInput {
  /**
   * The env bag to check. Defaults to `process.env`. Tests pass a
   * custom record so they don't need to mutate global state.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * In `production`, `PAYMENT_WEBHOOK_SECRET` is required even when
   * no real provider is configured (the mock provider falls back to
   * a hard-coded dev secret in non-production). Defaults to
   * `process.env.NODE_ENV`.
   */
  nodeEnv?: string;
}

export interface ProviderSecretAssertionResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

function isSet(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function checkProviderSecrets(
  input: ProviderSecretAssertionInput = {},
): ProviderSecretAssertionResult {
  const env = input.env ?? process.env;
  const nodeEnv = input.nodeEnv ?? env.NODE_ENV ?? "development";
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const group of GROUPS) {
    const triggerSet = isSet(env[group.triggerVar]);
    if (!triggerSet) continue; // provider disabled — companion vars optional
    const missing = group.requiredCompanions.filter((name) => !isSet(env[name]));
    if (missing.length > 0) {
      errors.push(
        `Provider « ${group.provider} » is half-configured: ${group.triggerVar} is set ` +
          `but missing ${missing.map((m) => `\`${m}\``).join(", ")}. ` +
          (group.hint ?? "Set all companion vars or unset the trigger var to disable the provider."),
      );
    }
  }

  // PAYMENT_WEBHOOK_SECRET — required in production for the mock
  // provider's webhook signing (and as a defence-in-depth for any
  // future provider that opts to use it). Outside production, the
  // module-level fallback in `payment.service.ts` is acceptable.
  if (nodeEnv === "production" && !isSet(env.PAYMENT_WEBHOOK_SECRET)) {
    errors.push(
      "PAYMENT_WEBHOOK_SECRET is required in production. " +
        "It signs the mock-provider webhook bodies and acts as a fallback secret for any " +
        "provider whose verifier can't fall through to the per-provider secret.",
    );
  }

  // Webhook IP allowlist warnings — dev posture by default, but log
  // a one-shot warning so production operators don't silently miss
  // the network-layer defence (P1-15). The middleware fail-OPENs on
  // unset, so this is a heads-up not a hard error.
  if (nodeEnv === "production") {
    const ipVars = ["WAVE_WEBHOOK_IPS", "OM_WEBHOOK_IPS", "PAYDUNYA_WEBHOOK_IPS"];
    for (const v of ipVars) {
      if (!isSet(env[v])) {
        warnings.push(
          `${v} is unset — webhook IP allowlist for this provider is OFF (HMAC is the only line of defence).`,
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Throwing wrapper for use at boot. Calls `checkProviderSecrets()` and
 * raises an Error with all detected misconfigurations concatenated, so
 * the operator sees every problem in one log line (instead of fixing
 * one and bouncing the deploy to find the next).
 *
 * Warnings are written to stderr as structured JSON; they never
 * abort the boot.
 */
export function assertProviderSecrets(input: ProviderSecretAssertionInput = {}): void {
  const result = checkProviderSecrets(input);
  for (const w of result.warnings) {
    process.stderr.write(
      `${JSON.stringify({
        level: "warn",
        msg: "provider_secret_warning",
        warning: w,
        time: new Date().toISOString(),
      })}\n`,
    );
  }
  if (!result.ok) {
    const message =
      `Boot aborted — payment provider secrets misconfigured (P1-18):\n  - ${result.errors.join(
        "\n  - ",
      )}`;
    throw new Error(message);
  }
}
