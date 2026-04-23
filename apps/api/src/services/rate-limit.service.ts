import crypto from "node:crypto";
import { db, COLLECTIONS } from "@/config/firebase";
import { getRequestId } from "@/context/request-context";

// ─── Distributed rate-limit service (Phase D.4) ─────────────────────────────
// Backs a sliding-window-ish rate-limit bucket with Firestore so multi-pod
// Cloud Run deployments actually share a budget. The original Phase B.1
// test-send limiter lived in a process-local Map — that silently multiplied
// the configured budget by N when we scaled to N pods.
//
// ### Deterministic document id
//
// The doc id is `${scope}:${hashedIdentifier}:${windowStartBucket}` where:
//
//   - scope              — logical namespace (e.g. "test-send:self") that
//                          partitions budgets so one noisy consumer cannot
//                          exhaust another's quota.
//   - hashedIdentifier   — sha256(rawIdentifier).slice(0, 16). NEVER the
//                          raw value — rate-limit keys frequently carry
//                          PII (emails, tokens) and we want audit logs to
//                          stay clean even when the id collides with a
//                          field attacker-controlled input might shape.
//   - windowStartBucket  — floor(nowSec / windowSec) * windowSec. Every
//                          caller in the same (scope, identifier, window)
//                          triple lands on the same doc so the Firestore
//                          transaction gives us a correct post-increment
//                          count regardless of concurrency.
//
// ### Doc shape
//
//   rateLimitBuckets/{id}
//     id, scope, identifier (hashed), count, limit, windowSec,
//     windowStartAt (ISO), expiresAt (ISO), createdAt (ISO)
//
// `expiresAt` = windowStartAt + 2 × windowSec. The 2× headroom gives
// operators a window to inspect a hot bucket post-rollover before
// Firestore's async TTL sweeps it away. See
// `infrastructure/firebase/firestore.ttl.md` for the gcloud provisioning
// command.
//
// ### Failure model
//
// A Firestore outage must NEVER become an availability outage for the
// calling surface (login, notifications, token registration…). The helper
// therefore fails OPEN — returns `{ allowed: true, count: 0 }` on any
// error — and logs a structured warn line so SRE can spot the degradation.
// A throttling outage is strictly preferable to an auth/UX outage.
//
// `RATE_LIMIT_DISABLED=true` (env var) short-circuits BEFORE any Firestore
// call, for test suites that want deterministic allow-all behavior.

export interface RateLimitOptions {
  /** Logical namespace, e.g. "test-send:self". */
  scope: string;
  /** Caller-scoped key, typically uid or email. */
  identifier: string;
  /** Maximum requests per window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
}

export interface RateLimitResult {
  /** True iff the caller may proceed. Callers are expected to return 429
   *  when this is false. */
  allowed: boolean;
  /** Post-increment count in the current window. 0 when the helper was
   *  short-circuited (env-disabled) or failed open. */
  count: number;
  /** The configured limit (echoed back for caller convenience / headers). */
  limit: number;
  /** Seconds until the current window rolls. Populated when allowed=false
   *  so the HTTP layer can set a Retry-After header. */
  retryAfterSec?: number;
}

/**
 * sha256(id).slice(0, 16). 16 hex chars = 64 bits of collision space,
 * plenty for per-user rate-limit buckets and short enough to keep doc
 * ids within Firestore's 1500-byte path limit. Matches the fingerprint
 * helper used by `fcm-tokens.service.ts`.
 */
function hashIdentifier(identifier: string): string {
  return crypto.createHash("sha256").update(identifier).digest("hex").slice(0, 16);
}

/**
 * Atomic check-and-increment. Callers throw 429 when `allowed === false`.
 *
 * Semantics:
 *   - First hit in a window → allowed, count=1.
 *   - 2..N hits             → allowed, count increments.
 *   - (N+1)th hit           → denied, count stays at limit+1 internally
 *                             (so subsequent hits keep being denied
 *                             without further writes), retryAfterSec set.
 *   - Post-window hit       → new doc (different windowStartBucket),
 *                             count=1.
 *
 * Correctness: the read-modify-write runs inside `db.runTransaction` so
 * concurrent callers at the Nth slot cannot both observe count=N-1 and
 * both conclude "still room for one more". Firestore serializes the txn
 * retries for us.
 *
 * Fail-open: any Firestore error is logged (structured warn line with
 * requestId) and the caller is allowed through. We deliberately lose
 * rate-limit enforcement rather than the underlying operation.
 */
export async function rateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  // Test/escape hatch. Checked BEFORE any Firestore work so unit tests
  // can assert zero Firestore calls occur in the disabled path.
  if (process.env.RATE_LIMIT_DISABLED === "true") {
    return { allowed: true, count: 0, limit: opts.limit };
  }

  const hashedId = hashIdentifier(opts.identifier);
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const windowStartSec = Math.floor(nowSec / opts.windowSec) * opts.windowSec;
  const windowEndSec = windowStartSec + opts.windowSec;
  const windowStartAt = new Date(windowStartSec * 1000).toISOString();
  // 2× window headroom gives operators time to inspect hot buckets
  // post-rollover before Firestore's async TTL sweeps them away.
  const expiresAt = new Date((windowStartSec + opts.windowSec * 2) * 1000).toISOString();
  const nowIso = new Date(nowMs).toISOString();

  const docId = `${opts.scope}:${hashedId}:${windowStartSec}`;

  try {
    const ref = db.collection(COLLECTIONS.RATE_LIMIT_BUCKETS).doc(docId);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists
        ? ((snap.data() as { count?: number }) ?? {})
        : null;
      const prevCount = existing?.count ?? 0;
      const nextCount = prevCount + 1;

      if (prevCount >= opts.limit) {
        // Already at (or above) the budget for this window. Do NOT
        // increment further — repeatedly hitting a throttled endpoint
        // shouldn't cost us one Firestore write per attempt. We still
        // return the deny decision and a retryAfter hint.
        return { allowed: false, count: prevCount } as const;
      }

      if (snap.exists) {
        tx.update(ref, { count: nextCount });
      } else {
        tx.set(ref, {
          id: docId,
          scope: opts.scope,
          // Persist the HASHED identifier only. Raw PII never lands in
          // the bucket doc, not even through a debug read.
          identifier: hashedId,
          count: nextCount,
          limit: opts.limit,
          windowSec: opts.windowSec,
          windowStartAt,
          expiresAt,
          createdAt: nowIso,
        });
      }

      return { allowed: true, count: nextCount } as const;
    });

    if (!result.allowed) {
      const retryAfterSec = Math.max(1, windowEndSec - nowSec);
      return {
        allowed: false,
        count: result.count,
        limit: opts.limit,
        retryAfterSec,
      };
    }

    return { allowed: true, count: result.count, limit: opts.limit };
  } catch (err) {
    // Fail open: a throttling outage must not cascade into a feature
    // outage. Log a structured warn line so SRE dashboards surface the
    // degradation.
    process.stderr.write(
      JSON.stringify({
        level: "warn",
        event: "rate_limit.firestore_error",
        requestId: getRequestId(),
        scope: opts.scope,
        // hashed — raw identifier never leaves the calling stack frame
        identifierHash: hashedId,
        err: err instanceof Error ? err.message : String(err),
      }) + "\n",
    );
    return { allowed: true, count: 0, limit: opts.limit };
  }
}
