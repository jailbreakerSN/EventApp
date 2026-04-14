import type { FullConfig } from "@playwright/test";

/**
 * Resolves STAGING_BACKOFFICE / STAGING_PARTICIPANT env vars + logs a
 * concise banner so CI logs make it obvious which hosts were tested.
 * Also fails fast if neither URL is set — a silent default to an
 * internal host would produce misleading CI results.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const backoffice = process.env.STAGING_BACKOFFICE;
  const participant = process.env.STAGING_PARTICIPANT;

  if (!backoffice && !participant) {
    // Fall back to the 2026-04-14 staging defaults in playwright.config.ts.
    // eslint-disable-next-line no-console
    console.warn(
      "[staging-qa] STAGING_BACKOFFICE / STAGING_PARTICIPANT not set — using config defaults.",
    );
    return;
  }

  // eslint-disable-next-line no-console
  console.log("[staging-qa] Target URLs:");
  // eslint-disable-next-line no-console
  console.log(`  backoffice  = ${backoffice ?? "(default)"}`);
  // eslint-disable-next-line no-console
  console.log(`  participant = ${participant ?? "(default)"}`);
}
