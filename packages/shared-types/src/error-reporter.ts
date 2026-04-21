import type { ErrorDescriptor } from "./error-descriptor";

/**
 * Shape of a client-side error reporter — anything that can take a caught
 * error plus its extracted descriptor and forward it to a vendor (Sentry,
 * Glitchtip, Datadog RUM, etc.). The hook calls this on every non-`info`
 * error so user-facing failures always leave an observability trail,
 * independent of which vendor (if any) the deployment chooses to wire up.
 *
 * Intentionally narrower than a direct `captureException` call — passing
 * the descriptor alongside the raw error means the reporter can tag with
 * `error.code`, `error.reason`, and `error.status` without re-parsing.
 */
export type ErrorReporter = (error: unknown, descriptor: ErrorDescriptor) => void;

let registered: ErrorReporter | null = null;

/**
 * Register the process-wide error reporter. Call once from the client
 * entry point (e.g. `apps/web-participant/src/app/client-init.tsx`)
 * after initialising Sentry. Overwrites any prior reporter so tests
 * can register a spy, then `setErrorReporter(null)` to clean up.
 */
export function setErrorReporter(reporter: ErrorReporter | null): void {
  registered = reporter;
}

export function getErrorReporter(): ErrorReporter | null {
  return registered;
}

/**
 * Safely invoke the registered reporter. Swallows reporter exceptions so
 * a buggy observability integration never breaks the product UX.
 */
export function reportError(error: unknown, descriptor: ErrorDescriptor): void {
  if (!registered) return;
  try {
    registered(error, descriptor);
  } catch {
    // Intentionally silent — reporter failures must not cascade.
  }
}
