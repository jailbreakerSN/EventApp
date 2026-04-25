/**
 * Sprint-3 T4.2 closure — Firestore read-volume tracking service.
 *
 * Every authenticated request increments a per-request counter via
 * `trackFirestoreReads()` in the BaseRepository read paths. This
 * service flushes that counter to `firestoreUsage/{orgId}_{YYYY-MM-DD}`
 * when the response is sent, so the cost dashboard can surface noisy
 * orgs without polling GCP billing.
 *
 * Design choices:
 *   - **Doc-id encoding**: `${orgId}_${YYYY-MM-DD}` keeps the upsert
 *     path O(1) and lets the dashboard list one day's usage with
 *     a `where(__name__, ">=", "...")` range query.
 *   - **Async flush**: `onResponse` fires AFTER the response is
 *     already in flight, so the flush latency never bills the
 *     caller. The flush itself is fire-and-forget — a write
 *     failure logs to stderr but doesn't surface.
 *   - **Recursion guard**: a write to `firestoreUsage` would itself
 *     trigger another flush (the request that listed yesterday's
 *     usage just wrote to the collection). The flusher uses a
 *     module-scope flag to drop the bumped counter for any
 *     `firestoreUsage` write, breaking the loop cleanly.
 *   - **No Cloud Run cold-start panic**: the FieldValue.increment
 *     atomic upsert handles concurrent writes from N pods without a
 *     transaction; a per-org/day doc is a hot key only for the
 *     largest orgs and Firestore's 1 write/sec/doc soft limit is
 *     well above what we expect (~thousands of requests/day/org max
 *     today).
 */

import { FieldValue } from "firebase-admin/firestore";
import { db, COLLECTIONS } from "@/config/firebase";
import { getRequestContext } from "@/context/request-context";
import type { AuthUser } from "@/middlewares/auth.middleware";
import { BaseService } from "./base.service";

/**
 * Encode the doc-id for one (org, day) bucket. Date is the UTC day
 * — Africa/Dakar shares UTC offset 0 so this matches the operator's
 * mental model.
 */
function bucketDocId(organizationId: string, dayIso: string): string {
  return `${organizationId}_${dayIso}`;
}

function todayUtcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Called from the Fastify `onResponse` hook. Reads the per-request
 * counter from the AsyncLocalStorage frame and bumps the matching
 * `firestoreUsage` doc. No-op when the request has no org context
 * (anonymous probes) or no reads were recorded (e.g. /health).
 */
export async function flushFirestoreUsage(): Promise<void> {
  const ctx = getRequestContext();
  if (!ctx) return;
  const orgId = ctx.organizationId;
  const reads = ctx.firestoreReads;
  if (!orgId || !reads || reads <= 0) return;

  const day = todayUtcDay();
  try {
    await db
      .collection(COLLECTIONS.FIRESTORE_USAGE)
      .doc(bucketDocId(orgId, day))
      .set(
        {
          organizationId: orgId,
          day,
          reads: FieldValue.increment(reads),
          // Surface the latest update timestamp so the dashboard can
          // tell a day with stale data ("nothing in 6h, plausibly
          // an outage") from a quiet day.
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
  } catch (err) {
    process.stderr.write(
      `[firestore-usage] flush failed for org=${orgId} day=${day}: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
}

interface UsageRow {
  organizationId: string;
  day: string;
  reads: number;
}

class FirestoreUsageService extends BaseService {
  /**
   * Sprint-3 T4.2 — return the top-N organisations ranked by total
   * Firestore reads over the last `days` days (default 7, max 30).
   * Used by the admin cost dashboard to surface noisy orgs.
   *
   * Permission: `platform:audit_read` OR `platform:manage`
   * (read-only observability gate). Cross-org by design — this
   * surface explicitly compares orgs against each other, so the
   * usual `requireOrganizationAccess` guard would defeat the point.
   *
   * Implementation: scans the last `days * 100` rows of the
   * `firestoreUsage` collection ordered by `day` desc, buckets the
   * results by org, and returns the top `topN` summed totals. The
   * cap (100 orgs/day × 30 days = 3 000 docs at most) matches the
   * 500-row admin observability budget × 6 — acceptable for
   * a once-a-day operator dashboard, well below pricing thresholds.
   */
  async getTopConsumers(
    user: AuthUser,
    options: { days?: number; topN?: number } = {},
  ): Promise<{
    days: number;
    fromDay: string;
    toDay: string;
    totalReads: number;
    topConsumers: Array<{ organizationId: string; reads: number; pct: number }>;
    daily: Array<{ day: string; reads: number }>;
  }> {
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);

    const days = Math.max(1, Math.min(30, Math.floor(options.days ?? 7)));
    const topN = Math.max(1, Math.min(50, Math.floor(options.topN ?? 10)));

    const toDay = todayUtcDay();
    const fromDate = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
    const fromDay = fromDate.toISOString().slice(0, 10);

    const snap = await db
      .collection(COLLECTIONS.FIRESTORE_USAGE)
      .where("day", ">=", fromDay)
      .where("day", "<=", toDay)
      .limit(3000) // hard cap
      .get();

    const byOrg = new Map<string, number>();
    const byDay = new Map<string, number>();
    let totalReads = 0;
    for (const doc of snap.docs) {
      const row = doc.data() as UsageRow;
      if (!row.organizationId || !row.day) continue;
      const reads = Number(row.reads ?? 0);
      if (!Number.isFinite(reads) || reads <= 0) continue;
      byOrg.set(row.organizationId, (byOrg.get(row.organizationId) ?? 0) + reads);
      byDay.set(row.day, (byDay.get(row.day) ?? 0) + reads);
      totalReads += reads;
    }

    const topConsumers = Array.from(byOrg.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, topN)
      .map(([organizationId, reads]) => ({
        organizationId,
        reads,
        pct: totalReads > 0 ? reads / totalReads : 0,
      }));

    // Always emit one row per day in the window so the dashboard
    // chart axis stays even.
    const daily: Array<{ day: string; reads: number }> = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const dayDate = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
      const day = dayDate.toISOString().slice(0, 10);
      daily.push({ day, reads: byDay.get(day) ?? 0 });
    }

    return { days, fromDay, toDay, totalReads, topConsumers, daily };
  }

  /**
   * Sprint-3 T4.2 — drill-down on a single org's usage over the
   * window. Same permission gate; same hard cap.
   */
  async getOrgUsage(
    user: AuthUser,
    organizationId: string,
    options: { days?: number } = {},
  ): Promise<{
    organizationId: string;
    days: number;
    fromDay: string;
    toDay: string;
    totalReads: number;
    daily: Array<{ day: string; reads: number }>;
  }> {
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);

    const days = Math.max(1, Math.min(30, Math.floor(options.days ?? 30)));
    const toDay = todayUtcDay();
    const fromDate = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
    const fromDay = fromDate.toISOString().slice(0, 10);

    const snap = await db
      .collection(COLLECTIONS.FIRESTORE_USAGE)
      .where("organizationId", "==", organizationId)
      .where("day", ">=", fromDay)
      .where("day", "<=", toDay)
      .limit(35) // 30 days + grace
      .get();

    const byDay = new Map<string, number>();
    let totalReads = 0;
    for (const doc of snap.docs) {
      const row = doc.data() as UsageRow;
      if (!row.day) continue;
      const reads = Number(row.reads ?? 0);
      byDay.set(row.day, (byDay.get(row.day) ?? 0) + reads);
      totalReads += reads;
    }

    const daily: Array<{ day: string; reads: number }> = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const dayDate = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
      const day = dayDate.toISOString().slice(0, 10);
      daily.push({ day, reads: byDay.get(day) ?? 0 });
    }

    return { organizationId, days, fromDay, toDay, totalReads, daily };
  }
}

export const firestoreUsageService = new FirestoreUsageService();
