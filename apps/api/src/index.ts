import { buildApp } from "./app";
import { config } from "./config/index";

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
// Cloud Run sends SIGTERM before stopping a container. We drain in-flight
// requests (Fastify's close() does this) with a 10s budget, then exit.

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main() {
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
    app.log.fatal({ err: reason }, "Unhandled promise rejection — crashing");
    process.exit(1);
  });

  process.on("uncaughtException", (err) => {
    app.log.fatal({ err }, "Uncaught exception — crashing");
    process.exit(1);
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
