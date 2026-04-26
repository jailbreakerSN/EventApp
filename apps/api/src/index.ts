// Sentry must initialise before any other application import so its Node SDK
// auto-instrumentation can hook into outgoing HTTP and fs calls before
// Fastify/firebase-admin load them. No-op when SENTRY_DSN is unset.
import { initSentry, captureError, closeSentry } from "./observability/sentry";
initSentry();

import { buildApp } from "./app";
import { config } from "./config/index";
import { assertProviderSecrets } from "./config/assert-provider-secrets";

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
// Cloud Run sends SIGTERM before stopping a container. We drain in-flight
// requests (Fastify's close() does this) with a 10s budget, then exit.

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main() {
  // P1-18 (audit L3) — boot-time assertion that payment-provider
  // secrets are coherent (all-set or all-unset for each provider).
  // Half-configured providers silently break webhook verification in
  // production; we'd rather refuse to start than serve traffic with
  // a 30-minute-invisible-failure mode. The check throws on any
  // misconfiguration; the outer try/catch below catches it and exits
  // with code 1 + a clear stderr message.
  try {
    assertProviderSecrets();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const app = await buildApp();

  // ── Graceful shutdown handler ───────────────────────────────────────────
  let shuttingDown = false;

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;

    app.log.info(`Received ${signal} — starting graceful shutdown`);

    // Force exit if close() hangs beyond the timeout
    const forceTimer = setTimeout(() => {
      app.log.error("Shutdown timeout exceeded — forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref(); // Don't keep the process alive just for this timer

    try {
      await app.close(); // Drains in-flight requests, closes keep-alive connections
      await closeSentry(); // Flush pending Sentry events before exit
      app.log.info("Graceful shutdown complete");
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "Error during shutdown");
      process.exit(1);
    }
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // ── Unhandled rejection / uncaught exception ────────────────────────────
  // Log and crash — running in an undefined state is worse than restarting.
  process.on("unhandledRejection", (reason) => {
    captureError(reason, { source: "unhandledRejection" });
    app.log.fatal({ err: reason }, "Unhandled promise rejection — crashing");
    // Give Sentry a brief window to flush before exit.
    closeSentry(1000).finally(() => process.exit(1));
  });

  process.on("uncaughtException", (err) => {
    captureError(err, { source: "uncaughtException" });
    app.log.fatal({ err }, "Uncaught exception — crashing");
    closeSentry(1000).finally(() => process.exit(1));
  });

  // ── Start server ────────────────────────────────────────────────────────
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    app.log.info(`Teranga API listening on ${config.HOST}:${config.PORT}`);

    if (config.NODE_ENV !== "production") {
      app.log.info(`API docs: http://localhost:${config.PORT}/docs`);
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
