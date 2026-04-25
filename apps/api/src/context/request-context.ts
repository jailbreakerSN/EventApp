import { AsyncLocalStorage } from "node:async_hooks";

// ─── Request Context ─────────────────────────────────────────────────────────
// Propagated through the entire async call chain via AsyncLocalStorage.
// Set once in the onRequest Fastify hook, available everywhere without
// explicit parameter threading.

export interface RequestContext {
  requestId: string;
  userId?: string;
  organizationId?: string;
  startTime: number;
  /**
   * Sprint-3 T4.2 — per-request Firestore read counter. Incremented
   * by the BaseRepository read paths (`findById`, `findMany`,
   * `count`, `paginatedQuery`, raw `db.collection().get()` chains
   * via `trackRead`). Flushed once at request completion to
   * `firestoreUsage/{orgId}_{YYYY-MM-DD}` so the cost dashboard can
   * surface noisy orgs. Stays a running counter at the request
   * level so each request flushes a single aggregate row instead
   * of N writes for N reads.
   */
  firestoreReads?: number;
}

/**
 * Sprint-3 T4.2 — increment the per-request Firestore read counter.
 * Called from the BaseRepository read paths and from any ad-hoc
 * `db.collection().get()` site that wants to be tracked. Safe
 * outside a request context (no-op when there's no ALS frame).
 */
export function trackFirestoreReads(count: number = 1): void {
  const ctx = asyncLocalStorage.getStore();
  if (!ctx) return;
  ctx.firestoreReads = (ctx.firestoreReads ?? 0) + count;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Run a function within a request context.
 * Called once per request in the Fastify onRequest hook.
 */
export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return asyncLocalStorage.run(ctx, fn);
}

/**
 * Get the current request context. Returns undefined outside a request.
 */
export function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Get the current request ID. Returns "no-request" outside a request.
 */
export function getRequestId(): string {
  return asyncLocalStorage.getStore()?.requestId ?? "no-request";
}

/**
 * Get the current actor's user ID. Returns undefined if not authenticated.
 */
export function getActorId(): string | undefined {
  return asyncLocalStorage.getStore()?.userId;
}

/**
 * Enrich the context with user info (called after authentication runs).
 */
export function enrichContext(userId: string, organizationId?: string): void {
  const ctx = asyncLocalStorage.getStore();
  if (ctx) {
    ctx.userId = userId;
    ctx.organizationId = organizationId;
  }
}
