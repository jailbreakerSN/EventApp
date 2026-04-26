import { BaseService } from "./base.service";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { adminRepository } from "@/repositories/admin.repository";
import { venueRepository } from "@/repositories/venue.repository";
import { planRepository } from "@/repositories/plan.repository";
import { db, auth, COLLECTIONS } from "@/config/firebase";
import type { UserRecord } from "firebase-admin/auth";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { NotFoundError, ForbiddenError } from "@/errors/app-error";
import { rateLimit } from "./rate-limit.service";
import { impersonationCodeService } from "./impersonation-code.service";
import type {
  PlatformStats,
  PlanAnalytics,
  AdminUserQuery,
  AdminOrgQuery,
  AdminEventQuery,
  AdminVenueQuery,
  AdminPaymentQuery,
  AdminSubscriptionQuery,
  AdminInviteQuery,
  OrganizationInvite,
  AdminAuditQuery,
  AdminUserRow,
  ClaimsMatch,
  UserProfile,
  Organization,
  Event,
  AuditLogEntry,
  Payment,
  Plan,
  Subscription,
  Venue,
} from "@teranga/shared-types";
import type { PaginatedResult } from "@/repositories/base.repository";
import { eventRepository } from "@/repositories/event.repository";
import { computePlanAnalytics } from "./plan-analytics";
import { Readable } from "node:stream";

// ─── Admin Service ──────────────────────────────────────────────────────────
// Platform-wide administration. Every method requires platform:manage permission.

/**
 * Grace window during which a fresh user (Firestore doc newly created)
 * can have empty/undefined Auth custom claims without triggering a
 * drift warning. Chosen so the onUserCreated trigger has enough time
 * to run and write the initial claim set — 5 minutes is generous for
 * both local emulators and Cloud Functions cold-starts in prod.
 */
const CLAIMS_PROPAGATION_GRACE_MS = 5 * 60 * 1000;

/**
 * Set-equality for role arrays — the ordering differs between Firestore
 * (insertion order) and Auth custom claims (server-assigned), but the
 * semantic set is what matters for drift detection.
 */
function arraysEqualAsSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const aSet = new Set(a);
  for (const item of b) if (!aSet.has(item)) return false;
  return true;
}

/**
 * Closure I — resolve the caller's narrowest impersonation-privileged
 * role. Impersonation is gated to `super_admin` and `platform:super_admin`
 * only; other `platform:*` roles (support, finance, ops, security) are
 * refused even though they hold `platform:manage`. Returning the narrow
 * role lets the audit log distinguish a legacy super_admin from a
 * granular platform:super_admin operator.
 */
function resolveImpersonationRole(user: AuthUser): "super_admin" | "platform:super_admin" {
  if (user.roles.includes("platform:super_admin")) return "platform:super_admin";
  if (user.roles.includes("super_admin")) return "super_admin";
  throw new ForbiddenError("Only super_admin may impersonate other users.");
}

class AdminService extends BaseService {
  // ── Platform Stats ────────────────────────────────────────────────────

  async getStats(user: AuthUser): Promise<PlatformStats> {
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);
    return adminRepository.getPlatformStats();
  }

  // ── CSV export (Phase 5) ──────────────────────────────────────────────
  // Streams a filtered list as CSV, one row at a time, so large exports
  // don't blow the Cloud Run heap. The caller must pass `resource` in
  // {users, organizations, events, audit-logs}. Filters are loose
  // (string → string) because the route layer hasn't validated them
  // against the Zod schemas yet — each export path does its own
  // sanitization.
  //
  // CSV quoting rules (RFC 4180): any value containing `"`, `,`, `\n`,
  // `\r` is wrapped in double-quotes, internal `"` doubled. Helper
  // csvCell() centralises the escape.
  exportCsv(
    user: AuthUser,
    resource: string,
    filters: Record<string, string | undefined>,
  ): Readable {
    this.requirePermission(user, "platform:manage");

    // Note: written without regex literals on purpose. The static
    // index-coverage linter's brace-tracker doesn't understand regex
    // literal syntax (`/.../`) and treats embedded `"` as string
    // delimiters — when this helper used `/[",\n\r]/` the tracker
    // never re-balanced and `csvCell`'s body was extended to the
    // end of the file, dragging unrelated `db.collection(...)` calls
    // into spurious raw-chunk matches that the linter then reported
    // as missing indexes. Plain string includes() + split/join keep
    // the tracker honest.
    const NEEDS_QUOTE = ['"', ",", "\n", "\r"];
    const csvCell = (v: unknown): string => {
      if (v == null) return "";
      const s = String(v);
      const needsQuote = NEEDS_QUOTE.some((c) => s.includes(c));
      return needsQuote ? `"${s.split('"').join('""')}"` : s;
    };
    // PAGE_SIZE = 500 keeps each Firestore read small + caps max memory
    // per chunk while still being efficient (max 100 reads for 50k rows).
    const PAGE_SIZE = 500;

    async function* rows(): AsyncGenerator<string> {
      if (resource === "users") {
        yield "uid,email,displayName,roles,organizationId,orgRole,isActive,createdAt\n";
        let page = 1;
        for (;;) {
          const result = await adminRepository.listAllUsers({}, { page, limit: PAGE_SIZE });
          if (result.data.length === 0) break;
          for (const u of result.data) {
            yield [
              csvCell(u.uid),
              csvCell(u.email),
              csvCell(u.displayName),
              csvCell((u.roles ?? []).join("|")),
              csvCell(u.organizationId ?? ""),
              csvCell(u.orgRole ?? ""),
              csvCell(u.isActive),
              csvCell(u.createdAt),
            ].join(",") + "\n";
          }
          if (result.data.length < PAGE_SIZE) break;
          page++;
        }
        return;
      }

      if (resource === "organizations") {
        yield "id,name,slug,plan,city,country,isVerified,isActive,memberCount,createdAt\n";
        let page = 1;
        for (;;) {
          const result = await adminRepository.listAllOrganizations({}, { page, limit: PAGE_SIZE });
          if (result.data.length === 0) break;
          for (const o of result.data) {
            yield [
              csvCell(o.id),
              csvCell(o.name),
              csvCell(o.slug),
              csvCell(o.plan),
              csvCell(o.city ?? ""),
              csvCell(o.country),
              csvCell(o.isVerified),
              csvCell(o.isActive),
              csvCell((o.memberIds ?? []).length),
              csvCell(o.createdAt),
            ].join(",") + "\n";
          }
          if (result.data.length < PAGE_SIZE) break;
          page++;
        }
        return;
      }

      if (resource === "events") {
        yield "id,title,slug,status,format,organizationId,startDate,endDate,registeredCount,createdAt\n";
        const filterStatus = filters.status;
        const filterOrg = filters.organizationId;
        let page = 1;
        for (;;) {
          const result = await adminRepository.listAllEvents(
            { status: filterStatus, organizationId: filterOrg },
            { page, limit: PAGE_SIZE },
          );
          if (result.data.length === 0) break;
          for (const e of result.data) {
            yield [
              csvCell(e.id),
              csvCell(e.title),
              csvCell(e.slug),
              csvCell(e.status),
              csvCell(e.format),
              csvCell(e.organizationId),
              csvCell(e.startDate),
              csvCell(e.endDate),
              csvCell((e as unknown as { registeredCount?: number }).registeredCount ?? 0),
              csvCell(e.createdAt),
            ].join(",") + "\n";
          }
          if (result.data.length < PAGE_SIZE) break;
          page++;
        }
        return;
      }

      if (resource === "audit-logs") {
        yield "timestamp,action,actorId,actorRole,resourceType,resourceId,organizationId\n";
        let page = 1;
        for (;;) {
          const result = await adminRepository.listAuditLogs(
            {
              action: filters.action,
              actorId: filters.actorId,
              resourceType: filters.resourceType,
              dateFrom: filters.dateFrom,
              dateTo: filters.dateTo,
            },
            { page, limit: PAGE_SIZE },
          );
          if (result.data.length === 0) break;
          for (const a of result.data) {
            yield [
              csvCell(a.timestamp),
              csvCell(a.action),
              csvCell(a.actorId),
              csvCell((a as unknown as { actorRole?: string }).actorRole ?? ""),
              csvCell(a.resourceType),
              csvCell(a.resourceId),
              csvCell(a.organizationId ?? ""),
            ].join(",") + "\n";
          }
          if (result.data.length < PAGE_SIZE) break;
          page++;
        }
        return;
      }

      // ── Venues (T1.3) ────────────────────────────────────────────────
      // Paginated via venueRepository.findAll so the max-subset index
      // (status, city, country, venueType, isFeatured) takes effect.
      // Optional filter: `status` — admins typically export only the
      // pending queue for moderation follow-up.
      if (resource === "venues") {
        yield "id,name,slug,venueType,status,city,country,hostOrganizationId,contactEmail,contactPhone,isFeatured,rating,eventCount,createdAt\n";
        const filterStatus = filters.status as
          | "pending"
          | "approved"
          | "suspended"
          | "archived"
          | undefined;
        let page = 1;
        for (;;) {
          const result = await venueRepository.findAll(
            { status: filterStatus },
            { page, limit: PAGE_SIZE },
          );
          if (result.data.length === 0) break;
          for (const v of result.data) {
            yield [
              csvCell(v.id),
              csvCell(v.name),
              csvCell(v.slug),
              csvCell(v.venueType),
              csvCell(v.status),
              csvCell(v.address?.city ?? ""),
              csvCell(v.address?.country ?? ""),
              csvCell(v.hostOrganizationId ?? ""),
              csvCell(v.contactEmail),
              csvCell(v.contactPhone ?? ""),
              csvCell(v.isFeatured),
              csvCell(v.rating ?? ""),
              csvCell(v.eventCount),
              csvCell(v.createdAt),
            ].join(",") + "\n";
          }
          if (result.data.length < PAGE_SIZE) break;
          page++;
        }
        return;
      }

      // ── Plans (T1.3) ─────────────────────────────────────────────────
      // The plan catalog is low-cardinality (tens of rows even with
      // version history), so we pull the entire set in one shot.
      // Filters:
      //   - includeHistory=true → every version of every lineage
      //   - includeArchived=true → include archived plans
      //   - includePrivate=true → include non-public plans
      // Defaults match the public catalog view (latest + public only).
      if (resource === "plans") {
        yield "id,key,version,isLatest,lineageId,nameFr,nameEn,priceXof,billingCycle,sortOrder,isPublic,isArchived,createdAt\n";
        const plans = await planRepository.listCatalog({
          includeHistory: filters.includeHistory === "true",
          includeArchived: filters.includeArchived === "true",
          includePrivate: filters.includePrivate === "true",
        });
        for (const p of plans) {
          yield [
            csvCell(p.id),
            csvCell(p.key),
            csvCell((p as unknown as { version?: number }).version ?? ""),
            csvCell(p.isLatest ?? true),
            csvCell((p as unknown as { lineageId?: string }).lineageId ?? ""),
            csvCell((p as unknown as { name?: { fr?: string } }).name?.fr ?? ""),
            csvCell((p as unknown as { name?: { en?: string } }).name?.en ?? ""),
            csvCell((p as unknown as { priceXof?: number }).priceXof ?? 0),
            csvCell((p as unknown as { billingCycle?: string }).billingCycle ?? ""),
            csvCell((p as unknown as { sortOrder?: number }).sortOrder ?? 0),
            csvCell(p.isPublic ?? false),
            csvCell(p.isArchived ?? false),
            csvCell((p as unknown as { createdAt?: string }).createdAt ?? ""),
          ].join(",") + "\n";
        }
        return;
      }

      // ── Subscriptions (T1.3) ─────────────────────────────────────────
      // Direct Firestore cursor-paginated scan (subscription repo has no
      // admin list method). `status` filter optional — the common case
      // is "export past_due for churn follow-up".
      if (resource === "subscriptions") {
        yield "id,organizationId,plan,status,billingCycle,priceXof,startDate,endDate,trialEndsAt,createdAt\n";
        const filterStatus = filters.status;
        type SubRow = {
          id: string;
          organizationId?: string;
          plan?: string;
          status?: string;
          billingCycle?: string;
          priceXof?: number;
          startDate?: string;
          endDate?: string;
          trialEndsAt?: string;
          createdAt?: string;
        };
        let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
        for (;;) {
          let q = db
            .collection(COLLECTIONS.SUBSCRIPTIONS)
            .orderBy("createdAt", "desc")
            .limit(PAGE_SIZE);
          if (filterStatus) q = q.where("status", "==", filterStatus) as typeof q;
          if (lastDoc) q = q.startAfter(lastDoc);
          const snap = await q.get();
          if (snap.empty) break;
          for (const doc of snap.docs) {
            const s = { id: doc.id, ...doc.data() } as SubRow;
            yield [
              csvCell(s.id),
              csvCell(s.organizationId ?? ""),
              csvCell(s.plan ?? ""),
              csvCell(s.status ?? ""),
              csvCell(s.billingCycle ?? ""),
              csvCell(s.priceXof ?? 0),
              csvCell(s.startDate ?? ""),
              csvCell(s.endDate ?? ""),
              csvCell(s.trialEndsAt ?? ""),
              csvCell(s.createdAt ?? ""),
            ].join(",") + "\n";
          }
          if (snap.docs.length < PAGE_SIZE) break;
          lastDoc = snap.docs[snap.docs.length - 1] ?? null;
          if (!lastDoc) break;
        }
        return;
      }

      // ── Notifications (T1.3) ─────────────────────────────────────────
      // Dispatch log over a bounded window. Defaults to the last 30 days
      // to cap export size; admins can override via `dateFrom`/`dateTo`.
      // Optional `channel` / `result` filters narrow scope further.
      if (resource === "notifications") {
        yield "attemptedAt,notificationKey,channel,recipientRef,result,suppressionReason,providerMessageId\n";
        const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const dateFrom = filters.dateFrom ?? defaultFrom;
        const dateTo = filters.dateTo;
        const channel = filters.channel;
        const result = filters.result;
        type DispatchRow = {
          attemptedAt?: string;
          notificationKey?: string;
          channel?: string;
          recipientRef?: string;
          result?: string;
          suppressionReason?: string | null;
          providerMessageId?: string | null;
        };
        let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
        for (;;) {
          let q = db
            .collection(COLLECTIONS.NOTIFICATION_DISPATCH_LOG)
            .where("attemptedAt", ">=", dateFrom)
            .orderBy("attemptedAt", "desc")
            .limit(PAGE_SIZE);
          if (dateTo) q = q.where("attemptedAt", "<=", dateTo) as typeof q;
          if (channel) q = q.where("channel", "==", channel) as typeof q;
          if (result) q = q.where("result", "==", result) as typeof q;
          if (lastDoc) q = q.startAfter(lastDoc);
          const snap = await q.get();
          if (snap.empty) break;
          for (const doc of snap.docs) {
            const d = doc.data() as DispatchRow;
            yield [
              csvCell(d.attemptedAt ?? ""),
              csvCell(d.notificationKey ?? ""),
              csvCell(d.channel ?? ""),
              csvCell(d.recipientRef ?? ""),
              csvCell(d.result ?? ""),
              csvCell(d.suppressionReason ?? ""),
              csvCell(d.providerMessageId ?? ""),
            ].join(",") + "\n";
          }
          if (snap.docs.length < PAGE_SIZE) break;
          lastDoc = snap.docs[snap.docs.length - 1] ?? null;
          if (!lastDoc) break;
        }
        return;
      }

      // Unknown resource — emit a single-column CSV explaining the error.
      yield `error\n"Unknown resource: ${resource}"\n`;
    }

    return Readable.from(rows(), { encoding: "utf8" });
  }

  // ── Admin inbox signals (Phase 2) ─────────────────────────────────────
  // Returns the aggregated list of "things that need an operator's
  // attention". Each signal is a (category, title, count, severity,
  // href-with-filters) tuple so the UI can render a card + CTA without
  // any extra business logic.
  //
  // Design constraints:
  //  - FAST — all queries run in parallel, target <1s total.
  //  - Read-only — no side effects, safe to poll every 60s.
  //  - Bounded counts — we do NOT fetch the full doc, only counts.
  //  - Gracefully degraded — per-section failures return null counts
  //    instead of failing the whole inbox.
  async getInboxSignals(user: AuthUser): Promise<{
    signals: Array<{
      id: string;
      category: "moderation" | "accounts" | "billing" | "ops" | "events_live" | "anomaly";
      severity: "info" | "warning" | "critical";
      title: string;
      description: string;
      count: number;
      href: string;
    }>;
    computedAt: string;
  }> {
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);

    // Safe counting helper — a single failing collection shouldn't tank
    // the whole inbox. We swallow and return 0 on error, logging via
    // stderr since we don't want to pollute structured logs with
    // read-only probe noise.
    const safeCount = async (label: string, fn: () => Promise<number>): Promise<number> => {
      try {
        return await fn();
      } catch (err) {
        process.stderr.write(
          `[inbox] ${label} count failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        return 0;
      }
    };

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [
      pendingVenues,
      unverifiedOrgs,
      pendingPayments,
      pastDueSubs,
      failedPayments,
      expiredInvites,
      failedWebhooks,
      signupAnomalies,
      multiDeviceScans,
      eventsLive,
      stuckWaitlists,
      eventVelocityAnomalies,
      refundSpikes,
      downgradeVolume,
    ] = await Promise.all([
      safeCount("venues.pending", async () => {
        const snap = await db
          .collection(COLLECTIONS.VENUES)
          .where("status", "==", "pending")
          .count()
          .get();
        return snap.data().count;
      }),
      safeCount("orgs.unverified", async () => {
        const snap = await db
          .collection(COLLECTIONS.ORGANIZATIONS)
          .where("isVerified", "==", false)
          .count()
          .get();
        return snap.data().count;
      }),
      safeCount("payments.pending_24h", async () => {
        const snap = await db
          .collection(COLLECTIONS.PAYMENTS)
          .where("status", "==", "pending")
          .where("initiatedAt", "<=", twentyFourHoursAgo)
          .count()
          .get();
        return snap.data().count;
      }),
      safeCount("subscriptions.past_due", async () => {
        const snap = await db
          .collection(COLLECTIONS.SUBSCRIPTIONS)
          .where("status", "==", "past_due")
          .count()
          .get();
        return snap.data().count;
      }),
      safeCount("payments.failed", async () => {
        const snap = await db
          .collection(COLLECTIONS.PAYMENTS)
          .where("status", "==", "failed")
          .count()
          .get();
        return snap.data().count;
      }),
      safeCount("invites.expired", async () => {
        const snap = await db
          .collection(COLLECTIONS.INVITES)
          .where("status", "==", "expired")
          .count()
          .get();
        return snap.data().count;
      }),
      // T2.5 — payment webhook failures over the last 24h. Bounded
      // window so a single old failed webhook never permanently
      // fills the inbox; new failures land within 24h and the
      // signal self-clears after the operator investigates (the
      // admin replay UI updates `processingStatus` which this query
      // implicitly honours).
      safeCount("webhooks.failed_24h", async () => {
        const snap = await db
          .collection(COLLECTIONS.WEBHOOK_EVENTS)
          .where("processingStatus", "==", "failed")
          .where("firstReceivedAt", ">=", twentyFourHoursAgo)
          .count()
          .get();
        return snap.data().count;
      }),
      // T4.2 — anomaly signal: multiple signups from the same IP in
      // the last 24h. The Firebase Auth event trigger stamps
      // `signupIp` on the user doc (see apps/functions/src/triggers/
      // auth.triggers.ts); we bucket by IP in memory to flag any IP
      // that produced ≥ 5 signups in a day. Raw signups-per-day
      // volume is small enough (< 200/day today) that a client-side
      // bucketing pass is cheaper than maintaining a dedicated
      // aggregation index.
      safeCount("anomaly.signups_by_ip", async () => {
        const snap = await db
          .collection(COLLECTIONS.USERS)
          .where("createdAt", ">=", twentyFourHoursAgo)
          .select("signupIp")
          .limit(500) // hard cap — exceeding this itself is an anomaly
          .get();
        const byIp = new Map<string, number>();
        for (const doc of snap.docs) {
          const ip = (doc.data() as { signupIp?: unknown }).signupIp;
          if (typeof ip !== "string" || !ip) continue;
          byIp.set(ip, (byIp.get(ip) ?? 0) + 1);
        }
        let suspiciousIps = 0;
        for (const count of byIp.values()) {
          if (count >= 5) suspiciousIps++;
        }
        return suspiciousIps;
      }),
      // T4.2 — anomaly signal: same registration scanned multiple
      // times from DIFFERENT scanner devices. The checkins
      // collection stamps `scannerDeviceId` on each scan; if a
      // single `registrationId` appears with ≥ 2 distinct device
      // ids, that's a badge-share signal.
      safeCount("anomaly.multi_device_scans", async () => {
        const snap = await db
          .collection(COLLECTIONS.CHECKINS)
          .where("createdAt", ">=", twentyFourHoursAgo)
          .select("registrationId", "scannerDeviceId")
          .limit(500)
          .get();
        const devicesPerReg = new Map<string, Set<string>>();
        for (const doc of snap.docs) {
          const row = doc.data() as {
            registrationId?: string;
            scannerDeviceId?: string;
          };
          if (!row.registrationId || !row.scannerDeviceId) continue;
          const set = devicesPerReg.get(row.registrationId) ?? new Set<string>();
          set.add(row.scannerDeviceId);
          devicesPerReg.set(row.registrationId, set);
        }
        let badgeShares = 0;
        for (const devices of devicesPerReg.values()) {
          if (devices.size >= 2) badgeShares++;
        }
        return badgeShares;
      }),
      // T5.1 / closes P2.1 — events currently in-progress across the
      // platform. "Live" = status: "published" AND startDate <= now
      // AND endDate >= now. Surfaced so ops has at-a-glance awareness
      // of concurrent production events (spikes correlate with
      // webhook volume, check-in load, support contact rate).
      //
      // Firestore single-index limitation: we can only range-filter
      // on one field per query. We filter server-side on startDate,
      // then check `endDate >= now` in memory — bounded by the 500-
      // row hard cap and startDate-range already cuts to events that
      // began recently. In practice the live-event window is tiny
      // (most events are ≤ 3 days), so the memory filter runs against
      // at most a few dozen rows.
      safeCount("events_live", async () => {
        const nowIso = new Date().toISOString();
        // Pull events whose startDate is in the past, ordered
        // desc. Any event that STARTED before now but hasn't yet
        // ENDED is a candidate.
        const snap = await db
          .collection(COLLECTIONS.EVENTS)
          .where("status", "==", "published")
          .where("startDate", "<=", nowIso)
          .orderBy("startDate", "desc")
          .select("endDate")
          .limit(500)
          .get();
        let live = 0;
        for (const doc of snap.docs) {
          const row = doc.data() as { endDate?: string };
          if (!row.endDate) continue;
          if (row.endDate >= nowIso) live++;
        }
        return live;
      }),
      // Phase 7+ B2 closure — stuck-waitlist signal. We count
      // distinct events that produced a `waitlist.promotion_failed`
      // audit row in the last 24h. That action fires when a
      // cancel-driven promotion attempt exhausts retries OR a bulk
      // promotion entry stalls — both are signs the organizer
      // (or our retry loop) couldn't drain the waitlist
      // automatically and a human should intervene.
      //
      // Counting distinct eventIds (rather than total failure rows)
      // matches operator intuition: "how many events need looking
      // at" is the actionable metric, not "how many failure
      // attempts happened in total" which can spike for a single
      // misconfigured event.
      safeCount("waitlist.stuck", async () => {
        const snap = await db
          .collection(COLLECTIONS.AUDIT_LOGS)
          .where("action", "==", "waitlist.promotion_failed")
          .where("timestamp", ">=", twentyFourHoursAgo)
          .select("resourceId")
          .limit(500)
          .get();
        const stuck = new Set<string>();
        for (const doc of snap.docs) {
          const row = doc.data() as { resourceId?: string };
          if (row.resourceId) stuck.add(row.resourceId);
        }
        return stuck.size;
      }),
      // Sprint-4 T3.4 — event velocity anomaly. Counts orgs that
      // created ≥ 6 events in the last 24h. The free plan caps
      // at 3 active events so any org breaching 6 in a day is
      // either trial-spamming, scripting, or onboarded a bulk
      // import (third case = legitimate but worth surfacing).
      // Reads from the `event.created` audit rows so we don't
      // need a dedicated counter on each org.
      safeCount("anomaly.event_velocity", async () => {
        const snap = await db
          .collection(COLLECTIONS.AUDIT_LOGS)
          .where("action", "==", "event.created")
          .where("timestamp", ">=", twentyFourHoursAgo)
          .select("organizationId")
          .limit(1000)
          .get();
        const byOrg = new Map<string, number>();
        for (const doc of snap.docs) {
          const row = doc.data() as { organizationId?: string };
          if (!row.organizationId) continue;
          byOrg.set(row.organizationId, (byOrg.get(row.organizationId) ?? 0) + 1);
        }
        let flagged = 0;
        for (const count of byOrg.values()) {
          if (count >= 6) flagged += 1;
        }
        return flagged;
      }),
      // Sprint-4 T3.4 — refund spike anomaly. Counts orgs that saw
      // ≥ 3 refunds in the last 30 days. A normal org refunds
      // sporadically (1-2 / month is benign); 3+ in 30d signals a
      // problematic event (mass cancellation, dispute wave) that
      // the customer-success team should chase before churn.
      safeCount("anomaly.refund_spike", async () => {
        const snap = await db
          .collection(COLLECTIONS.AUDIT_LOGS)
          .where("action", "==", "payment.refunded")
          .where("timestamp", ">=", thirtyDaysAgoIso)
          .select("organizationId")
          .limit(1000)
          .get();
        const byOrg = new Map<string, number>();
        for (const doc of snap.docs) {
          const row = doc.data() as { organizationId?: string };
          if (!row.organizationId) continue;
          byOrg.set(row.organizationId, (byOrg.get(row.organizationId) ?? 0) + 1);
        }
        let flagged = 0;
        for (const count of byOrg.values()) {
          if (count >= 3) flagged += 1;
        }
        return flagged;
      }),
      // Sprint-4 T3.4 — downgrade volume anomaly. Raw count of
      // `subscription.downgraded` audit rows in the last 7 days.
      // Spikes correlate with churn campaigns or pricing
      // backlash — finance + product own the response.
      safeCount("anomaly.downgrade_volume", async () => {
        const snap = await db
          .collection(COLLECTIONS.AUDIT_LOGS)
          .where("action", "==", "subscription.downgraded")
          .where("timestamp", ">=", sevenDaysAgo)
          .count()
          .get();
        return snap.data().count;
      }),
    ]);

    const signals: Array<{
      id: string;
      category: "moderation" | "accounts" | "billing" | "ops" | "events_live" | "anomaly";
      severity: "info" | "warning" | "critical";
      title: string;
      description: string;
      count: number;
      href: string;
    }> = [];

    if (pendingVenues > 0) {
      signals.push({
        id: "venues.pending",
        category: "moderation",
        severity: "warning",
        title: `${pendingVenues} ${pendingVenues > 1 ? "lieux" : "lieu"} en attente de modération`,
        description: "Soumis par des organisateurs, à approuver ou rejeter.",
        count: pendingVenues,
        href: "/admin/venues?status=pending",
      });
    }

    if (unverifiedOrgs > 0) {
      signals.push({
        id: "orgs.unverified",
        category: "moderation",
        severity: "info",
        title: `${unverifiedOrgs} organisation${unverifiedOrgs > 1 ? "s" : ""} non vérifiée${unverifiedOrgs > 1 ? "s" : ""}`,
        description: "À KYB : confirmer l'identité avant activation complète.",
        count: unverifiedOrgs,
        href: "/admin/organizations?isVerified=false",
      });
    }

    if (pendingPayments > 0) {
      signals.push({
        id: "payments.pending",
        category: "billing",
        severity: "warning",
        title: `${pendingPayments} paiement${pendingPayments > 1 ? "s" : ""} en attente depuis plus de 24h`,
        description: "Vérifier auprès du provider ou marquer comme échoué.",
        count: pendingPayments,
        href: "/admin/audit?action=payment.initiated",
      });
    }

    if (pastDueSubs > 0) {
      signals.push({
        id: "subscriptions.past_due",
        category: "billing",
        severity: "critical",
        title: `${pastDueSubs} abonnement${pastDueSubs > 1 ? "s" : ""} en impayé`,
        description: "Relance en cours — accompagner avant churn.",
        count: pastDueSubs,
        // Points at the filtered subscriptions list (review 2026-04-24
        // follow-up). Previously landed on the summary-only page with
        // no way to see the impacted orgs — operators had to open
        // /admin/organizations and eyeball each plan badge.
        href: "/admin/subscriptions?status=past_due",
      });
    }

    if (failedPayments > 0) {
      signals.push({
        id: "payments.failed",
        category: "billing",
        severity: "info",
        title: `${failedPayments} paiement${failedPayments > 1 ? "s" : ""} échoué${failedPayments > 1 ? "s" : ""}`,
        description: "Historique des échecs — relancer ou contacter.",
        count: failedPayments,
        // Points at the new /admin/payments surface (review 2026-04-24
        // follow-up). The previous target `/admin/audit?action=payment.failed`
        // queried the audit log but the count probe reads the payments
        // collection directly — so any failed payment without a
        // matching audit row landed the operator on an empty list.
        href: "/admin/payments?status=failed",
      });
    }

    if (expiredInvites > 0) {
      signals.push({
        id: "invites.expired",
        category: "accounts",
        severity: "info",
        title: `${expiredInvites} invitation${expiredInvites > 1 ? "s" : ""} expirée${expiredInvites > 1 ? "s" : ""}`,
        description: "À nettoyer ou à relancer selon le contexte.",
        count: expiredInvites,
        // Points at the new /admin/invites surface (review 2026-04-24
        // follow-up). Previously landed on unfiltered /admin/organizations
        // — operators had no list of invites to action, only orgs to
        // drill into one by one. `status=expired` hydrates the filter
        // dropdown on the invites page.
        href: "/admin/invites?status=expired",
      });
    }

    if (failedWebhooks > 0) {
      // T2.5 — failed payment webhooks are the #1 ops signal for
      // payment-lifecycle debugging. `warning` severity (not
      // critical) — provider retries usually recover on their own,
      // and our replay console is a 1-click fix.
      signals.push({
        id: "webhooks.failed",
        category: "ops",
        severity: "warning",
        title: `${failedWebhooks} webhook${failedWebhooks > 1 ? "s" : ""} en échec sur les 24 dernières heures`,
        description: "Replay depuis la console /admin/webhooks après diagnostic du provider.",
        count: failedWebhooks,
        href: "/admin/webhooks?processingStatus=failed",
      });
    }

    // T4.2 — anomaly widgets. Treated as `warning` severity by
    // default: these are suspicious patterns, not confirmed
    // incidents. Investigation usually starts by drilling into the
    // related list (users for signups, checkins for scan anomalies).
    if (signupAnomalies > 0) {
      signals.push({
        id: "anomaly.signups_by_ip",
        category: "anomaly",
        severity: "warning",
        title: `${signupAnomalies} adresse${signupAnomalies > 1 ? "s" : ""} IP avec inscriptions anormales`,
        description:
          "≥ 5 inscriptions depuis la même IP en 24h. Signal bot ou inscription frauduleuse.",
        count: signupAnomalies,
        href: "/admin/users?sort=createdAt&order=desc",
      });
    }

    if (multiDeviceScans > 0) {
      signals.push({
        id: "anomaly.multi_device_scans",
        category: "anomaly",
        severity: "warning",
        title: `${multiDeviceScans} inscription${multiDeviceScans > 1 ? "s" : ""} scannée${multiDeviceScans > 1 ? "s" : ""} sur plusieurs appareils`,
        description: "Même QR scanné par ≥ 2 scanners distincts en 24h. Signal badge-share.",
        count: multiDeviceScans,
        href: "/admin/audit?action=checkin.completed",
      });
    }

    // T5.1 — events currently live on the platform. Info severity:
    // "N events running right now" is situational awareness, not an
    // alert. Category `events_live` (already defined in the signal
    // type union) routes to the inbox's dedicated "events live"
    // section and deep-links to the events page filtered by
    // status: published.
    if (eventsLive > 0) {
      signals.push({
        id: "events.live",
        category: "events_live",
        severity: "info",
        title: `${eventsLive} événement${eventsLive > 1 ? "s" : ""} en cours`,
        description:
          "Événements publiés dont la plage horaire est en cours. Surveiller la charge webhook + check-in.",
        count: eventsLive,
        href: "/admin/events?status=published",
      });
    }

    // Phase 7+ B2 closure — surface stuck waitlists. Warning severity
    // (not critical) because the underlying `waitlist.promotion_failed`
    // can be transient (Firestore contention) and the retry loop
    // usually self-heals. The deep-link points at the audit log
    // filtered on the action so the operator sees which events
    // failed + why (the audit row carries `failureKind` + `reason`
    // in its details payload).
    if (stuckWaitlists > 0) {
      signals.push({
        id: "waitlist.stuck",
        category: "ops",
        severity: "warning",
        title: `${stuckWaitlists} événement${stuckWaitlists > 1 ? "s" : ""} avec liste d'attente bloquée`,
        description:
          "Promotion de waitlist en échec sur les 24 dernières heures. Investiguer manuellement ou relancer.",
        count: stuckWaitlists,
        href: "/admin/audit?action=waitlist.promotion_failed",
      });
    }

    // Sprint-4 T3.4 — anomaly widgets (velocity / refund / downgrade).
    // Severity: warning by default (suspicious patterns, not
    // confirmed incidents); operator drills via the deep-linked
    // audit query.
    if (eventVelocityAnomalies > 0) {
      signals.push({
        id: "anomaly.event_velocity",
        category: "anomaly",
        severity: "warning",
        title: `${eventVelocityAnomalies} organisation${eventVelocityAnomalies > 1 ? "s" : ""} avec rythme de création anormal`,
        description:
          "≥ 6 événements créés en 24h. Signal scripting / trial-spam ou import en masse légitime.",
        count: eventVelocityAnomalies,
        href: "/admin/audit?action=event.created",
      });
    }

    if (refundSpikes > 0) {
      signals.push({
        id: "anomaly.refund_spike",
        category: "anomaly",
        severity: "warning",
        title: `${refundSpikes} organisation${refundSpikes > 1 ? "s" : ""} avec pic de remboursements`,
        description:
          "≥ 3 remboursements sur 30 jours. Investiguer la cause (annulation d'événement, dispute, fraude).",
        count: refundSpikes,
        href: "/admin/audit?action=payment.refunded",
      });
    }

    if (downgradeVolume > 0) {
      signals.push({
        id: "anomaly.downgrade_volume",
        category: "anomaly",
        severity: "warning",
        title: `${downgradeVolume} downgrade${downgradeVolume > 1 ? "s" : ""} d'abonnement (7j)`,
        description:
          "Volume de downgrades sur 7 jours. Surveiller si supérieur à la baseline pour détecter une vague de churn.",
        count: downgradeVolume,
        href: "/admin/audit?action=subscription.downgraded",
      });
    }

    return {
      signals,
      computedAt: new Date().toISOString(),
    };
  }

  // ── Cross-object search ───────────────────────────────────────────────
  // Phase 1 — powers the admin command palette (⌘K). Fans out to 4
  // paginated-list queries in parallel, filters each client-side by
  // substring, and caps at 5 hits per type. Intentionally NOT hitting
  // a dedicated search index — volumes are small enough that a few
  // limit(20) reads + string contains gives acceptable latency at
  // 1/100th the complexity of Algolia. See the route in admin.routes.ts
  // for shape + caller contract.
  async globalSearch(
    user: AuthUser,
    query: string,
  ): Promise<{
    users: Array<{ id: string; label: string; sublabel?: string }>;
    organizations: Array<{ id: string; label: string; sublabel?: string }>;
    events: Array<{ id: string; label: string; sublabel?: string }>;
    venues: Array<{ id: string; label: string; sublabel?: string }>;
  }> {
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);
    const q = query.trim().toLowerCase();
    if (q.length < 2) {
      return { users: [], organizations: [], events: [], venues: [] };
    }

    const matches = (...fields: Array<string | null | undefined>): boolean =>
      fields.some((f) => f && f.toLowerCase().includes(q));

    const [usersPage, orgsPage, eventsPage, venuesPage] = await Promise.all([
      adminRepository.listAllUsers({}, { page: 1, limit: 50 }),
      adminRepository.listAllOrganizations({}, { page: 1, limit: 50 }),
      adminRepository.listAllEvents({}, { page: 1, limit: 50 }),
      adminRepository.listAllVenues({}, { page: 1, limit: 50 }),
    ]);

    const users = usersPage.data
      .filter((u) => matches(u.displayName, u.email))
      .slice(0, 5)
      .map((u) => ({
        id: u.uid,
        label: u.displayName ?? u.email,
        sublabel: u.email !== u.displayName ? u.email : undefined,
      }));

    const organizations = orgsPage.data
      .filter((o) => matches(o.name, o.slug))
      .slice(0, 5)
      .map((o) => ({
        id: o.id,
        label: o.name,
        sublabel: o.slug,
      }));

    const events = eventsPage.data
      .filter((e) => matches(e.title, e.slug))
      .slice(0, 5)
      .map((e) => ({
        id: e.id,
        label: e.title,
        sublabel: e.slug,
      }));

    const venues = venuesPage.data
      .filter((v) => matches(v.name, v.slug, v.address?.city))
      .slice(0, 5)
      .map((v) => ({
        id: v.id,
        label: v.name,
        sublabel: v.address?.city ?? v.slug,
      }));

    return { users, organizations, events, venues };
  }

  // ── User Management ───────────────────────────────────────────────────

  // ── Impersonation (Phase 4) ───────────────────────────────────────────
  // Mint a short-lived Firebase custom token that lets the calling
  // super-admin "log in as" another user. Security rails:
  //   - super_admin only (hard-gated by platform:manage permission
  //     + tighter sanity check here to protect against future role
  //     downgrades).
  //   - Cannot impersonate another super_admin (prevent privilege
  //     escalation chains).
  //   - Custom claims carry `impersonatedBy: <adminUid>` so every
  //     downstream action traces back to the original actor even if
  //     the impersonated session writes to Firestore.
  //   - Audit log `user.impersonated` emitted synchronously for
  //     compliance.
  //   - Client must treat the returned token as single-use: it is
  //     minted fresh on every call, and the legacy session MUST be
  //     signed-out before exchanging the new token.
  //
  // The returned token is a Firebase custom token (not an ID token).
  // The client exchanges it via signInWithCustomToken() which gives
  // back a real ID token whose custom claims are stamped at exchange
  // time.
  async startImpersonation(
    user: AuthUser,
    targetUid: string,
    context: {
      /** Raw caller IP as observed by Fastify (`request.ip`). */
      ip?: string | null;
      /** Caller User-Agent. */
      ua?: string | null;
    } = {},
  ): Promise<{
    /**
     * Opaque, single-use, 60-second TTL authorization code. The caller's
     * browser must open `acceptUrl` (new tab) and the target app's
     * `/impersonation/accept` route will exchange this code for a
     * Firebase custom token via `/v1/impersonation/exchange`. The raw
     * custom token never travels through URLs, fragments, or history.
     */
    code: string;
    acceptUrl: string;
    targetOrigin: string;
    expiresAt: string;
    targetUid: string;
    targetDisplayName: string | null;
    targetEmail: string | null;
    targetRoles: string[];
  }> {
    this.requirePermission(user, "platform:manage");
    // Closure I — accept both legacy `super_admin` and the granular
    // `platform:super_admin` role shipped in closure C. Other platform:*
    // roles (support, finance, ops, security) MUST NOT be able to
    // impersonate — this is the most sensitive action on the platform.
    // The resolved label is also what we stamp on the audit row so the
    // audit trail reflects who actually acted.
    const actorRole = resolveImpersonationRole(user);
    if (user.uid === targetUid) {
      throw new ForbiddenError("Cannot impersonate yourself.");
    }

    // Phase 4 rate limit — bound impersonation usage per admin so a
    // compromised super-admin session can't be used to probe 1000
    // accounts in a row. 20 successful sessions per rolling hour is
    // generous for legitimate customer-success workflows. Applies at
    // the ISSUE step — a code that is issued but never consumed still
    // counts against the quota (defence against recon-through-issue).
    const rl = await rateLimit({
      scope: "admin.impersonate",
      identifier: user.uid,
      limit: 20,
      windowSec: 3600,
    });
    if (!rl.allowed) {
      throw new ForbiddenError(
        `Quota d'impersonation atteint (20/h). Réessayez dans ${rl.retryAfterSec ?? 600}s.`,
      );
    }

    const targetDoc = await db.collection(COLLECTIONS.USERS).doc(targetUid).get();
    if (!targetDoc.exists) {
      throw new NotFoundError("User", targetUid);
    }
    const targetProfile = targetDoc.data() as UserProfile;

    // Never impersonate another top-tier admin — blocks privilege
    // escalation / lateral-attack loops and forces the audit trail on
    // the HIGHEST-privilege admin. Closure I: both `super_admin` and
    // `platform:super_admin` are top-tier; guard both target classes.
    const targetRoles = targetProfile.roles ?? [];
    const targetIsTopAdmin =
      targetRoles.includes("super_admin") || targetRoles.includes("platform:super_admin");
    if (targetIsTopAdmin && targetUid !== user.uid) {
      throw new ForbiddenError("Cannot impersonate another super_admin.");
    }

    // Look up the admin's display name so the target app's banner can
    // render "Impersonation par <admin>" without a second API round-trip.
    // Best-effort — a missing doc is stamped as null rather than
    // aborting the issue (the admin's session is live, so their profile
    // must exist, but we don't want to fail closed on a transient read).
    let actorDisplayName: string | null = null;
    try {
      const actorDoc = await db.collection(COLLECTIONS.USERS).doc(user.uid).get();
      if (actorDoc.exists) {
        actorDisplayName = (actorDoc.data() as UserProfile).displayName ?? null;
      }
    } catch {
      /* swallow — banner will fall back to "un·e super-administrateur·rice" */
    }

    // Delegate to the code service. It:
    //   1. Generates the 32-byte random code + SHA-256 hash.
    //   2. Persists the hash with the target uid, canonical target
    //      origin, audit fingerprint, and 60 s expiresAt.
    //   3. Returns the raw code + the accept URL the admin's browser
    //      should open (new tab).
    const issued = await impersonationCodeService.issue({
      admin: user,
      actorDisplayName,
      actorRole,
      target: { ...targetProfile, uid: targetUid },
      issueIp: context.ip ?? null,
      issueUa: context.ua ?? null,
    });

    // Audit log for the ISSUE step. Pair (requestId, actorId, targetUid)
    // with the matching `user.impersonation_exchanged` row — a code
    // that issues but never exchanges leaves only this row, which is
    // exactly the signal security alerting wants (possible failed
    // handoff or aborted admin action). Stamp the admin's IP + UA on
    // the row itself (not just the ephemeral code doc, which TTL-
    // purges in 60 s) so SOC-2 investigators reading only auditLogs
    // can reconstruct the full session fingerprint.
    await db.collection(COLLECTIONS.AUDIT_LOGS).add({
      action: "user.impersonated",
      actorId: user.uid,
      actorRole,
      resourceType: "user",
      resourceId: targetUid,
      organizationId: targetProfile.organizationId ?? null,
      details: {
        targetDisplayName: targetProfile.displayName ?? null,
        targetEmail: targetProfile.email ?? null,
        targetOrigin: issued.targetOrigin,
        codeExpiresAt: issued.expiresAt,
        flow: "auth_code",
        issueIp: context.ip ?? null,
        issueUa: context.ua ?? null,
      },
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    eventBus.emit("user.impersonated", {
      actorUid: user.uid,
      targetUid,
      expiresAt: issued.expiresAt,
    });

    return {
      code: issued.code,
      acceptUrl: issued.acceptUrl,
      targetOrigin: issued.targetOrigin,
      expiresAt: issued.expiresAt,
      targetUid,
      targetDisplayName: targetProfile.displayName ?? null,
      targetEmail: targetProfile.email ?? null,
      targetRoles,
    };
  }

  /**
   * Phase 4 — ends an impersonation session by revoking the impersonated
   * user's refresh tokens on the Firebase Auth side. Combined with the
   * client-side signOut + redirect flow, this guarantees the short-lived
   * ID token minted by startImpersonation() cannot be re-used even if it
   * was captured between sign-in and sign-out.
   *
   * Only super-admin may call this endpoint, and only with their OWN
   * admin uid (they pass the `actorUid` from the sessionStorage
   * breadcrumb). The server validates that the caller's claims include
   * `impersonatedBy === actorUid` which proves they're in a session
   * started by that admin.
   */
  async endImpersonation(user: AuthUser, actorUid: string): Promise<void> {
    // The caller is CURRENTLY impersonating — their JWT carries the
    // signed `impersonatedBy` claim baked by `startImpersonation`,
    // extracted into `AuthUser.impersonatedBy` by the auth middleware.
    // We validate it matches the actorUid the client echoed back from
    // its sessionStorage breadcrumb — both must agree.
    if (!user.impersonatedBy || user.impersonatedBy !== actorUid) {
      throw new ForbiddenError("Session d'impersonation non reconnue.");
    }
    // Revoke the impersonated uid's refresh tokens. If Firebase Auth
    // rejects (network, quota, internal error) we MUST NOT write an
    // audit claim of success — propagate the error to the route handler
    // so the admin UI can surface it and retry. The audit trail must
    // reflect reality. (Closure I, post-review #3.)
    await auth.revokeRefreshTokens(user.uid);

    // Stamp the admin's actual role (super_admin | platform:super_admin)
    // on the audit record. `user.roles` at this point reflects the
    // IMPERSONATED user, not the admin, so we look up the admin's doc
    // by UID. If the doc can't be read we fall back to "super_admin"
    // with a warning flag on the details blob — safer than blocking
    // the session exit on a transient read failure.
    const actorRole = await this.resolveActorRoleByUid(actorUid);

    await db.collection(COLLECTIONS.AUDIT_LOGS).add({
      action: "user.impersonation_ended",
      actorId: actorUid,
      actorRole: actorRole.role,
      resourceType: "user",
      resourceId: user.uid,
      organizationId: null,
      details: { ended: "manual", actorRoleLookup: actorRole.source },
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    // Emit a domain event for convention parity with every other admin
    // mutation — downstream listeners (security alerts, webhook relay)
    // can react without having to subscribe to the audit collection.
    eventBus.emit("user.impersonation_ended", {
      actorUid,
      targetUid: user.uid,
    });
  }

  /**
   * Closure I — look up the admin's narrowest super-admin role for
   * accurate audit stamping on `endImpersonation`. Returns `source`
   * so the audit record distinguishes a verified lookup from a
   * fallback (useful when forensically reconstructing sessions where
   * the admin doc was deleted mid-session).
   */
  private async resolveActorRoleByUid(actorUid: string): Promise<{
    role: "super_admin" | "platform:super_admin";
    source: "firestore" | "fallback";
  }> {
    try {
      const doc = await db.collection(COLLECTIONS.USERS).doc(actorUid).get();
      const roles = (doc.data() as { roles?: string[] } | undefined)?.roles ?? [];
      if (roles.includes("platform:super_admin")) {
        return { role: "platform:super_admin", source: "firestore" };
      }
      if (roles.includes("super_admin")) {
        return { role: "super_admin", source: "firestore" };
      }
    } catch {
      /* fall through to fallback */
    }
    return { role: "super_admin", source: "fallback" };
  }

  async getUserById(user: AuthUser, targetUid: string): Promise<AdminUserRow> {
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);
    const doc = await db.collection(COLLECTIONS.USERS).doc(targetUid).get();
    if (!doc.exists) {
      throw new NotFoundError("User", targetUid);
    }
    const profile = { uid: targetUid, ...doc.data() } as UserProfile;
    return this.attachClaimsMatch(profile);
  }

  async listUsers(user: AuthUser, query: AdminUserQuery): Promise<PaginatedResult<AdminUserRow>> {
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);
    const page = await adminRepository.listAllUsers(
      { q: query.q, role: query.role, isActive: query.isActive },
      { page: query.page, limit: query.limit },
    );

    // P0.6 — batch the JWT ↔ Firestore drift check via auth.getUsers([uids])
    // instead of N independent auth.getUser(uid) calls. Firebase Admin SDK
    // accepts up to 100 identifiers per batch; admin table page size is 20
    // so a single batch covers every page.
    if (page.data.length === 0) {
      return page as PaginatedResult<AdminUserRow>;
    }

    const identifiers = page.data.map((u) => ({ uid: u.uid }));
    let recordsByUid = new Map<string, UserRecord>();
    try {
      const batch = await auth.getUsers(identifiers);
      recordsByUid = new Map(batch.users.map((r) => [r.uid, r]));
      // batch.notFound contains identifiers that lack an Auth record — we
      // surface those rows with claimsMatch: null per attachClaimsMatch.
    } catch {
      // Auth SDK outage: every row gets claimsMatch: null. The admin UI
      // already renders this case as "drift unknown" and stays operable.
    }

    const enriched: AdminUserRow[] = page.data.map((profile) =>
      this.computeClaimsMatch(profile, recordsByUid.get(profile.uid) ?? null),
    );

    return { ...page, data: enriched };
  }

  /**
   * Compare a Firestore user doc's roles / organizationId / orgRole against
   * the Firebase Auth custom claims for the same uid. Returns the row
   * shape the admin UI consumes, with `claimsMatch: null` when the Auth
   * record can't be fetched (user deleted in Auth but doc lingers, or
   * transient Admin SDK failure — both worth surfacing visually).
   */
  private async attachClaimsMatch(profile: UserProfile): Promise<AdminUserRow> {
    let record: UserRecord | null = null;
    try {
      record = await auth.getUser(profile.uid);
    } catch {
      record = null;
    }
    return this.computeClaimsMatch(profile, record);
  }

  /**
   * Pure (sync) variant of attachClaimsMatch that takes a pre-fetched Auth
   * record. The async wrapper above keeps the single-fetch /admin/users/:uid
   * path simple; the batched listUsers path uses this directly to avoid N+1.
   *
   * `record === null` means "Auth fetch failed or user is missing in Auth"
   * — we still return the row with claimsMatch: null so the admin UI can
   * surface the warning badge instead of hiding the row.
   */
  private computeClaimsMatch(profile: UserProfile, record: UserRecord | null): AdminUserRow {
    const base: Omit<AdminUserRow, "claimsMatch"> = {
      uid: profile.uid,
      email: profile.email,
      displayName: profile.displayName,
      photoURL: profile.photoURL ?? null,
      phone: profile.phone ?? null,
      bio: profile.bio ?? null,
      roles: profile.roles,
      organizationId: profile.organizationId ?? null,
      orgRole: profile.orgRole ?? null,
      preferredLanguage: profile.preferredLanguage,
      isEmailVerified: profile.isEmailVerified,
      isActive: profile.isActive,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };

    if (!record) {
      return { ...base, claimsMatch: null };
    }

    const rawClaims = record.customClaims;
    const claims = (rawClaims ?? {}) as Record<string, unknown>;

    // Fresh-user grace window: if Auth has NO custom claims set yet
    // (undefined or empty object) AND the Firestore doc was created
    // less than CLAIMS_PROPAGATION_GRACE_MS ago, treat the two as in
    // sync. Rationale: the onUserCreated Cloud Function trigger sets
    // the initial claims asynchronously, so a brand-new account that
    // hasn't had its first claim-write yet will otherwise light up
    // a false-positive drift pill every single time.
    const claimsAreEmpty = rawClaims == null || Object.keys(claims).length === 0;
    const createdAtMs = new Date(profile.createdAt).getTime();
    const withinGraceWindow =
      Number.isFinite(createdAtMs) && Date.now() - createdAtMs < CLAIMS_PROPAGATION_GRACE_MS;
    if (claimsAreEmpty && withinGraceWindow) {
      return {
        ...base,
        claimsMatch: { roles: true, organizationId: true, orgRole: true },
      };
    }

    const claimRoles = (claims.roles as string[] | undefined) ?? [];
    const claimOrgId = (claims.organizationId as string | null | undefined) ?? null;
    const claimOrgRole = (claims.orgRole as string | null | undefined) ?? null;

    const match: ClaimsMatch = {
      roles: arraysEqualAsSet(profile.roles, claimRoles),
      organizationId: (profile.organizationId ?? null) === claimOrgId,
      orgRole: (profile.orgRole ?? null) === claimOrgRole,
    };
    return { ...base, claimsMatch: match };
  }

  async updateUserRoles(user: AuthUser, targetUserId: string, roles: string[]): Promise<void> {
    this.requirePermission(user, "platform:manage");

    // Prevent self-demotion from super_admin
    if (targetUserId === user.uid && !roles.includes("super_admin")) {
      throw new ForbiddenError("Impossible de retirer votre propre rôle super_admin");
    }

    // Transactional read-then-write on the Firestore side so two concurrent
    // admin updates can't interleave. The Auth claims mutation remains
    // outside the transaction boundary (cross-system — Auth is not part of
    // Firestore's atomicity), so we keep the compensating rollback below.
    const { oldRoles, organizationId } = await db.runTransaction(async (tx) => {
      const userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
      const snap = await tx.get(userRef);
      if (!snap.exists) throw new NotFoundError("User", targetUserId);
      const data = snap.data()!;
      const prevRoles = (data.roles as string[]) ?? ["participant"];
      tx.update(userRef, { roles, updatedAt: new Date().toISOString() });
      return {
        oldRoles: prevRoles,
        organizationId: (data.organizationId as string | undefined) ?? undefined,
      };
    });

    // Update Firebase Auth custom claims (critical — JWT is source of
    // truth for middleware). If this fails (transient Auth API outage,
    // Cloud Run cold-start to Auth, IAM revoke mid-request, etc.) we
    // roll back the Firestore write so the two stores stay aligned.
    // Without the rollback we'd recreate the exact symptom PR #59 fixed
    // for the onUserCreated trigger — admin UI shows new roles, JWT
    // still carries old ones, every endpoint denies the user, and the
    // operator has no signal that anything went wrong.
    try {
      await auth.setCustomUserClaims(targetUserId, {
        roles,
        organizationId,
      });
    } catch (err) {
      // Compensating write — best-effort, but the original Auth error
      // is what the operator needs to see, so we surface that.
      try {
        await db.collection(COLLECTIONS.USERS).doc(targetUserId).update({
          roles: oldRoles,
          updatedAt: new Date().toISOString(),
        });
      } catch (rollbackErr) {
        // The compensating write itself failed — log + continue. The
        // user doc is now in the new state but the claims are stale.
        // Surface the original Auth error so the operator retries.
        process.stderr.write(
          `admin.updateUserRoles: rollback FAILED for user ${targetUserId} after setCustomUserClaims error: ${String(rollbackErr)}\n`,
        );
      }
      throw err;
    }

    eventBus.emit("user.role_changed", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
      targetUserId,
      oldRoles,
      newRoles: roles,
    });
  }

  async updateUserStatus(user: AuthUser, targetUserId: string, isActive: boolean): Promise<void> {
    this.requirePermission(user, "platform:manage");

    // Prevent self-suspension
    if (targetUserId === user.uid) {
      throw new ForbiddenError("Impossible de suspendre votre propre compte");
    }

    // Transactional read-then-write — same rationale as updateUserRoles().
    const previousIsActive = await db.runTransaction(async (tx) => {
      const userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
      const snap = await tx.get(userRef);
      if (!snap.exists) throw new NotFoundError("User", targetUserId);
      const prev = (snap.data()?.isActive as boolean | undefined) ?? true;
      tx.update(userRef, { isActive, updatedAt: new Date().toISOString() });
      return prev;
    });

    // Disable/enable in Firebase Auth. Same drift-rollback story as
    // updateUserRoles: a transient Auth failure here would leave the
    // user marked inactive in Firestore (admin UI shows suspended) but
    // still able to log in (Auth doesn't know they're disabled).
    try {
      await auth.updateUser(targetUserId, { disabled: !isActive });
    } catch (err) {
      try {
        await db.collection(COLLECTIONS.USERS).doc(targetUserId).update({
          isActive: previousIsActive,
          updatedAt: new Date().toISOString(),
        });
      } catch (rollbackErr) {
        process.stderr.write(
          `admin.updateUserStatus: rollback FAILED for user ${targetUserId} after auth.updateUser error: ${String(rollbackErr)}\n`,
        );
      }
      throw err;
    }

    eventBus.emit("user.status_changed", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
      targetUserId,
      isActive,
    });
  }

  // ── Revenue snapshot (Senior-review F-2) ──────────────────────────────
  // Extracted from `routes/admin.routes.ts` so the service-layer
  // permission gate provides defense-in-depth on top of the route's
  // `readOnlyAdminPreHandler`. Sums priceXof per active subscription
  // to derive MRR (monthly), ARR (×12), and a per-plan breakdown.
  // On-demand; cardinality is tens of orgs.
  async getRevenueSnapshot(user: AuthUser): Promise<{
    mrrXof: number;
    arrXof: number;
    activeSubscriptions: number;
    byPlan: Record<string, { count: number; mrrXof: number }>;
    computedAt: string;
  }> {
    // `platform:audit_read` covers support / security / finance roles —
    // each of which carries audit_read by design. No dedicated
    // `platform:finance` granular permission exists; the role-name
    // appears in the catalog but routes/services gate on the
    // capability, not the role.
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);
    const snap = await db
      .collection(COLLECTIONS.SUBSCRIPTIONS)
      .where("status", "==", "active")
      .get();
    type Sub = {
      organizationId?: string;
      plan?: string;
      status?: string;
      priceXof?: number;
      billingCycle?: string;
    };
    let mrrXof = 0;
    const byPlan: Record<string, { count: number; mrrXof: number }> = {};
    for (const doc of snap.docs) {
      const s = doc.data() as Sub;
      const price = Number(s.priceXof ?? 0);
      // Normalise annual subs into monthly for the MRR aggregate.
      const monthly = s.billingCycle === "annual" ? Math.round(price / 12) : price;
      mrrXof += monthly;
      const plan = s.plan ?? "unknown";
      if (!byPlan[plan]) byPlan[plan] = { count: 0, mrrXof: 0 };
      byPlan[plan].count += 1;
      byPlan[plan].mrrXof += monthly;
    }
    return {
      mrrXof,
      arrXof: mrrXof * 12,
      activeSubscriptions: snap.size,
      byPlan,
      computedAt: new Date().toISOString(),
    };
  }

  // ── Organization Management ───────────────────────────────────────────

  async listOrganizations(
    user: AuthUser,
    query: AdminOrgQuery,
  ): Promise<PaginatedResult<Organization>> {
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);
    return adminRepository.listAllOrganizations(
      { q: query.q, plan: query.plan, isVerified: query.isVerified, isActive: query.isActive },
      { page: query.page, limit: query.limit },
    );
  }

  async verifyOrganization(user: AuthUser, orgId: string): Promise<void> {
    this.requirePermission(user, "platform:manage");

    // Senior-review F-4 — read-then-write must be transactional. A
    // concurrent caller can otherwise observe a doc that is then
    // deleted (silent no-op `.update()` instead of a 404) or two
    // concurrent verifications can race on the existence check.
    const ref = db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId);
    const now = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundError("Organization", orgId);
      tx.update(ref, { isVerified: true, updatedAt: now });
    });

    eventBus.emit("organization.verified", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
      organizationId: orgId,
    });
  }

  async updateOrgStatus(user: AuthUser, orgId: string, isActive: boolean): Promise<void> {
    this.requirePermission(user, "platform:manage");

    // Senior-review F-4 — same TOCTOU as `verifyOrganization` above.
    const ref = db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId);
    const now = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundError("Organization", orgId);
      tx.update(ref, { isActive, updatedAt: now });
    });

    eventBus.emit("organization.status_changed", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
      organizationId: orgId,
      isActive,
    });
  }

  // ── Event Oversight ───────────────────────────────────────────────────

  async listEvents(user: AuthUser, query: AdminEventQuery): Promise<PaginatedResult<Event>> {
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);
    return adminRepository.listAllEvents(
      {
        q: query.q,
        status: query.status,
        organizationId: query.organizationId,
        isRecurringParent: query.isRecurringParent,
        parentEventId: query.parentEventId,
      },
      { page: query.page, limit: query.limit },
    );
  }

  /**
   * Sprint-4 T3.1 closure — time-travel timeline for one resource.
   *
   * Returns the audit log for a single (resourceType, resourceId)
   * pair, optionally bounded by an `atIso` timestamp ("show me the
   * state at this date"). The response carries:
   *
   *   - `rows`: every audit row touching the resource, sorted
   *     ascending by `timestamp`, with the canonical fields plus
   *     a `details` payload (when the original event embedded it).
   *
   *   - `reconstructable`: a per-field map indicating whether the
   *     row's `details.before/after` shape is rich enough for the
   *     UI to render an authoritative diff. When false, the UI
   *     downgrades to "audit row recorded but pre-state not
   *     captured" — honest UX, no fake reconstruction.
   *
   *   - `coverage`: forensic metadata so the operator knows whether
   *     the audit retention window covered the requested date or
   *     whether the data is older than what the system can prove.
   *
   * Permission: `platform:audit_read OR platform:manage` (read-
   * only). Cross-org by design — investigating a customer's
   * forensic timeline is the canonical use case.
   */
  async getResourceTimeline(
    user: AuthUser,
    params: {
      resourceType: string;
      resourceId: string;
      atIso?: string;
    },
  ): Promise<{
    resourceType: string;
    resourceId: string;
    atIso: string | null;
    rows: Array<{
      id: string;
      action: string;
      actorId: string;
      actorRole: string | null;
      timestamp: string;
      details: Record<string, unknown> | null;
      reconstructable: boolean;
    }>;
    coverage: {
      oldestRowTimestamp: string | null;
      newestRowTimestamp: string | null;
      requestedDateInWindow: boolean | null;
    };
  }> {
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);

    // Bounded scan — same 500-row budget as the rest of the admin
    // observability surfaces. Most resources have far fewer audit
    // rows; the cap is a safety rail. If a resource hits this
    // ceiling, the operator should narrow via the time filter.
    const snap = await db
      .collection(COLLECTIONS.AUDIT_LOGS)
      .where("resourceType", "==", params.resourceType)
      .where("resourceId", "==", params.resourceId)
      .orderBy("timestamp", "asc")
      .limit(500)
      .get();

    const rows = snap.docs.map((doc) => {
      const data = doc.data() as {
        action?: string;
        actorId?: string;
        actorRole?: string | null;
        timestamp?: string;
        details?: Record<string, unknown> | null;
      };
      const details = data.details ?? null;
      // `reconstructable` is true when the audit row carries enough
      // information to render an authoritative before/after diff.
      // The canonical signal is a `details.before` AND a
      // `details.after` object — the state-snapshotting pattern
      // we use on `event.updated`, `plan.updated`, etc. Rows that
      // only carry a `changes: string[]` field-list are
      // partially-reconstructable (the UI shows changed field
      // names but not values). Pure-action rows
      // (`event.published`, `event.archived`) have no diff state
      // at all and surface as "transition" markers.
      const reconstructable =
        !!details &&
        typeof details === "object" &&
        "before" in details &&
        "after" in details;
      return {
        id: doc.id,
        action: data.action ?? "",
        actorId: data.actorId ?? "",
        actorRole: data.actorRole ?? null,
        timestamp: data.timestamp ?? "",
        details,
        reconstructable,
      };
    });

    // `atIso` filtering happens client-side — we always return the
    // full window the API can prove, so the operator can scrub the
    // timeline back and forth without a network round-trip per
    // tick. The atIso parameter is just echoed back so the UI can
    // pin the cursor without re-deriving it from query state.
    const oldestRowTimestamp = rows.length > 0 ? rows[0].timestamp : null;
    const newestRowTimestamp =
      rows.length > 0 ? rows[rows.length - 1].timestamp : null;
    const requestedDateInWindow = params.atIso
      ? oldestRowTimestamp !== null && params.atIso >= oldestRowTimestamp
      : null;

    return {
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      atIso: params.atIso ?? null,
      rows,
      coverage: {
        oldestRowTimestamp,
        newestRowTimestamp,
        requestedDateInWindow,
      },
    };
  }

  /**
   * A.3 closure — signup-cohort retention curve.
   *
   * For each of the last `months` calendar months (default 12), groups
   * organisations by the YYYY-MM of their `createdAt` and returns:
   *   - signupCount   : how many orgs joined in that cohort
   *   - retainedNow   : how many of those orgs still hold an
   *                     `active` subscription today
   *   - retentionPct  : retainedNow / signupCount (0 when 0/0)
   *
   * Implementation note — the response is NOT a true month-by-month
   * matrix (which would require subscription history reconstruction
   * from audit logs). It's a "current retention" curve, the most
   * actionable signal we can compute from current state alone:
   *   "of the orgs that signed up N months ago, what fraction are
   *    still paying us today?"
   *
   * Two bounded reads in parallel: the orgs collection filtered on
   * `createdAt >= startMonthIso` (cap 2000), and the active
   * subscriptions index (cap 2000). For Teranga's current scale
   * (tens to low hundreds of orgs / month) both fit easily; the cap
   * is a safety rail rather than a routine throttle.
   *
   * Permission: `platform:audit_read` OR `platform:manage`. Read-only.
   */
  async getRevenueCohorts(
    user: AuthUser,
    months: number,
  ): Promise<{
    cohorts: Array<{
      cohortMonth: string;
      signupCount: number;
      retainedNow: number;
      retentionPct: number;
      /** T2.4 — months elapsed between cohort signup and now. */
      monthsSinceSignup: number;
    }>;
    /**
     * T2.4 — derived "retention by age" curve. One point per
     * months-elapsed bucket where at least one cohort exists.
     */
    retentionCurve: Array<{
      monthsSinceSignup: number;
      retentionPct: number;
    }>;
    computedAt: string;
  }> {
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);

    // Hard cap on the lookback window. 24 months is more than enough
    // for any retention conversation a Sales / CS team needs today
    // and keeps the read tiny. Negative or zero defaults to 12.
    const lookback = Math.max(1, Math.min(24, Math.floor(months) || 12));
    const now = new Date();
    const cohortStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - lookback + 1, 1, 0, 0, 0, 0),
    );
    const startIso = cohortStart.toISOString();

    const [orgsSnap, subsSnap] = await Promise.all([
      db
        .collection(COLLECTIONS.ORGANIZATIONS)
        .where("createdAt", ">=", startIso)
        .select("createdAt")
        .limit(2000)
        .get(),
      db
        .collection(COLLECTIONS.SUBSCRIPTIONS)
        .where("status", "==", "active")
        .select("organizationId")
        .limit(2000)
        .get(),
    ]);

    // Build the "currently active" org set from the subscription
    // snapshot. We don't dedupe per-org because the sub query already
    // filters on `status: active` and an org should hold at most one
    // active subscription at a time (enforced by `subscription.service`
    // upgrade/cancel transactions).
    const activeOrgIds = new Set<string>();
    for (const doc of subsSnap.docs) {
      const sub = doc.data() as { organizationId?: string };
      if (sub.organizationId) activeOrgIds.add(sub.organizationId);
    }

    // Group orgs into YYYY-MM cohorts. We slice the ISO string
    // directly rather than `new Date()`-parsing each row — string
    // comparison is faster and avoids any local-time pitfalls
    // (createdAt is stored as UTC ISO 8601 throughout the platform).
    const cohortMap = new Map<string, { signupCount: number; retainedNow: number }>();
    for (const doc of orgsSnap.docs) {
      const data = doc.data() as { createdAt?: string };
      const orgId = doc.id;
      if (!data.createdAt) continue;
      const cohortMonth = data.createdAt.slice(0, 7); // "YYYY-MM"
      const entry = cohortMap.get(cohortMonth) ?? { signupCount: 0, retainedNow: 0 };
      entry.signupCount += 1;
      if (activeOrgIds.has(orgId)) entry.retainedNow += 1;
      cohortMap.set(cohortMonth, entry);
    }

    // Always emit a row per month in the lookback window so the UI
    // can render an even axis even when a month has zero signups.
    const cohorts: Array<{
      cohortMonth: string;
      signupCount: number;
      retainedNow: number;
      retentionPct: number;
      monthsSinceSignup: number;
    }> = [];
    for (let offset = 0; offset < lookback; offset += 1) {
      const monthDate = new Date(
        Date.UTC(cohortStart.getUTCFullYear(), cohortStart.getUTCMonth() + offset, 1),
      );
      const cohortMonth = monthDate.toISOString().slice(0, 7);
      const stats = cohortMap.get(cohortMonth) ?? { signupCount: 0, retainedNow: 0 };
      // T2.4 closure — `monthsSinceSignup` exposes how old each
      // cohort is so the UI can render a triangular heatmap
      // (cohort × elapsed-month). Without subscription-history
      // reconstruction we can only fill the diagonal cell — but
      // that's the most actionable signal: "of orgs that joined N
      // months ago, what fraction are still paying today?"
      const cohortYear = monthDate.getUTCFullYear();
      const cohortMonthIdx = monthDate.getUTCMonth();
      const monthsSinceSignup =
        (now.getUTCFullYear() - cohortYear) * 12 +
        (now.getUTCMonth() - cohortMonthIdx);
      cohorts.push({
        cohortMonth,
        signupCount: stats.signupCount,
        retainedNow: stats.retainedNow,
        retentionPct:
          stats.signupCount > 0 ? stats.retainedNow / stats.signupCount : 0,
        monthsSinceSignup,
      });
    }

    // T2.4 closure — derived "average retention by age" curve.
    // Each cohort contributes ONE data point (its retention at age
    // = monthsSinceSignup). The curve is the natural read of those
    // diagonal cells, which is the operator-facing equivalent of
    // "after N months, X% of cohorts retain Y%". Empty when no
    // cohort lands at that age (gaps left as null for the chart).
    const retentionByAge = new Map<number, { sum: number; count: number }>();
    for (const c of cohorts) {
      if (c.signupCount === 0) continue;
      const bucket = retentionByAge.get(c.monthsSinceSignup) ?? { sum: 0, count: 0 };
      bucket.sum += c.retentionPct;
      bucket.count += 1;
      retentionByAge.set(c.monthsSinceSignup, bucket);
    }
    const retentionCurve: Array<{ monthsSinceSignup: number; retentionPct: number }> = [];
    for (let age = 0; age < lookback; age += 1) {
      const bucket = retentionByAge.get(age);
      if (!bucket) continue;
      retentionCurve.push({
        monthsSinceSignup: age,
        retentionPct: bucket.sum / bucket.count,
      });
    }

    return {
      cohorts,
      retentionCurve,
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Phase 7+ B2 closure — waitlist health snapshot for one event.
   *
   * Returns the four counts an operator wants when an event surfaces
   * on the "stuck waitlist" inbox card:
   *   - `waitlistedCount`    — current pending demand
   *   - `promotedCount30d`   — successful drains in the last 30 days
   *   - `failureCount30d`    — promotion attempts that exhausted retries
   *   - `lastPromotedAt`     — timestamp of the most recent successful promotion (null if never)
   *
   * Read-only; no side effects. All four reads run in parallel
   * (`Promise.all`) so the round-trip stays under a single
   * Firestore RTT for the operator.
   *
   * Permission: `platform:manage` (admin-only). Cross-org by
   * design — this is the platform admin's investigation surface,
   * organizers reach the same data via their own /events/:id
   * waitlist tools.
   */
  async getWaitlistHealth(
    user: AuthUser,
    eventId: string,
  ): Promise<{
    eventId: string;
    waitlistedCount: number;
    promotedCount30d: number;
    failureCount30d: number;
    lastPromotedAt: string | null;
  }> {
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [waitlistedCount, promotedCount30d, failureCount30d, lastPromotedSnap] =
      await Promise.all([
        db
          .collection(COLLECTIONS.REGISTRATIONS)
          .where("eventId", "==", eventId)
          .where("status", "==", "waitlisted")
          .count()
          .get()
          .then((s) => s.data().count),
        db
          .collection(COLLECTIONS.AUDIT_LOGS)
          .where("action", "==", "waitlist.promoted")
          .where("resourceId", "==", eventId)
          .where("timestamp", ">=", thirtyDaysAgo)
          .count()
          .get()
          .then((s) => s.data().count),
        db
          .collection(COLLECTIONS.AUDIT_LOGS)
          .where("action", "==", "waitlist.promotion_failed")
          .where("resourceId", "==", eventId)
          .where("timestamp", ">=", thirtyDaysAgo)
          .count()
          .get()
          .then((s) => s.data().count),
        db
          .collection(COLLECTIONS.AUDIT_LOGS)
          .where("action", "==", "waitlist.promoted")
          .where("resourceId", "==", eventId)
          .orderBy("timestamp", "desc")
          .select("timestamp")
          .limit(1)
          .get(),
      ]);

    const lastPromotedAt = lastPromotedSnap.empty
      ? null
      : ((lastPromotedSnap.docs[0].data() as { timestamp?: string }).timestamp ?? null);

    return {
      eventId,
      waitlistedCount,
      promotedCount30d,
      failureCount30d,
      lastPromotedAt,
    };
  }

  // ── Venue Oversight ───────────────────────────────────────────────────
  // Powers /admin/venues. Unlike the public `venueService.listPublic`,
  // this surface respects every status (`pending` / `approved` /
  // `suspended` / `archived`) so the moderation inbox deep-link
  // (/admin/venues?status=pending) actually shows pending venues.
  async listVenues(user: AuthUser, query: AdminVenueQuery): Promise<PaginatedResult<Venue>> {
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);
    return adminRepository.listAllVenues(
      {
        status: query.status,
        venueType: query.venueType,
        city: query.city,
        country: query.country,
        isFeatured: query.isFeatured,
      },
      {
        page: query.page,
        limit: query.limit,
        orderBy: query.orderBy,
        orderDir: query.orderDir,
      },
    );
  }

  // ── Payment Oversight ─────────────────────────────────────────────────
  // Cross-org payments list for /admin/payments. Used by the
  // "X paiement(s) échoué(s)" inbox card, which previously linked to
  // the audit log and showed an empty list whenever audit entries
  // lagged behind the payments collection.
  async listPayments(user: AuthUser, query: AdminPaymentQuery): Promise<PaginatedResult<Payment>> {
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);
    return adminRepository.listAllPayments(
      {
        status: query.status,
        method: query.method,
        organizationId: query.organizationId,
        eventId: query.eventId,
      },
      // Use the repository's default orderBy (`createdAt DESC`) so the
      // declared indexes cover every realistic query shape.
      { page: query.page, limit: query.limit },
    );
  }

  // ── Subscription Oversight ────────────────────────────────────────────
  // Cross-org subscriptions list for /admin/subscriptions. Lets the
  // "X abonnement(s) en impayé" inbox card land on the concrete
  // past-due list instead of the summary-by-plan view.
  async listSubscriptions(
    user: AuthUser,
    query: AdminSubscriptionQuery,
  ): Promise<PaginatedResult<Subscription>> {
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);
    return adminRepository.listAllSubscriptions(
      { status: query.status, plan: query.plan },
      // Default orderBy (`createdAt DESC`) — same rationale as listPayments.
      { page: query.page, limit: query.limit },
    );
  }

  // ── Invite Oversight ──────────────────────────────────────────────────
  // Cross-org invitation list for `/admin/invites`. Used by the
  // "X invitation(s) expirée(s)" inbox card, which previously linked to
  // the unfiltered org list — operators had no way to see which invites
  // to relance or purge without drilling into each org manually.
  //
  // Default orderBy is inherited from `paginatedQuery` (`createdAt DESC`)
  // so audit + runtime agree on the required composite index shape.
  async listInvites(
    user: AuthUser,
    query: AdminInviteQuery,
  ): Promise<PaginatedResult<OrganizationInvite>> {
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);
    return adminRepository.listAllInvites(
      { status: query.status, organizationId: query.organizationId, role: query.role },
      { page: query.page, limit: query.limit },
    );
  }

  // ── Audit Logs ────────────────────────────────────────────────────────

  async listAuditLogs(
    user: AuthUser,
    query: AdminAuditQuery,
  ): Promise<PaginatedResult<AuditLogEntry>> {
    // T5.2 — defense-in-depth for the route-level narrowing. Every
    // platform:* role holds `platform:audit_read`; super_admin still
    // passes the `platform:manage` branch via the hasPermission()
    // all-pass rule. `profile:read_any` (held by organizer too) is
    // DELIBERATELY not in this allowlist — cross-tenant audit access
    // must stay platform-only.
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);
    return adminRepository.listAuditLogs(
      {
        action: query.action,
        actorId: query.actorId,
        resourceType: query.resourceType,
        resourceId: query.resourceId,
        organizationId: query.organizationId,
        search: query.search,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      { page: query.page, limit: query.limit, orderBy: "timestamp", orderDir: "desc" },
    );
  }

  // ── Plan Analytics (Phase 7+ item #5) ──────────────────────────────────
  //
  // Point-in-time aggregate for the superadmin dashboard. Runs one batched
  // fetch over the three collections we need (subscriptions, organizations,
  // plans) plus per-org event counts, folds them into a `PlanAnalytics`
  // shape in memory, and returns it. No server-side caching — the
  // numbers are small and operators want fresh data on refresh.
  //
  // The shape is described in detail by the `PlanAnalytics` type in
  // shared-types. The pure fold lives in `./plan-analytics.ts` so it's
  // unit-testable without the emulator.
  async getPlanAnalytics(user: AuthUser): Promise<PlanAnalytics> {
    this.requirePermission(user, "platform:manage");

    // Fetch subs, orgs, plans in parallel. Each list is bounded by a
    // generous `limit: 1000` — superadmins view this on fleets below that
    // scale in practice; when we outgrow it, a BigQuery export pipeline
    // is the right answer rather than paginated Firestore scans.
    const [subsSnap, orgsSnap, plansSnap] = await Promise.all([
      db.collection(COLLECTIONS.SUBSCRIPTIONS).limit(1000).get(),
      db.collection(COLLECTIONS.ORGANIZATIONS).limit(1000).get(),
      db.collection(COLLECTIONS.PLANS).get(),
    ]);

    const subscriptions = subsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Subscription);
    const organizations = orgsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Organization);
    const plans = plansSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Plan);

    // Parallel per-org event counts for the near-limit calculation. We
    // use the existing repository helper so the count stays consistent
    // with the runtime enforcement path (same `status IN` filter).
    const activeEventsByOrgId = new Map<string, number>();
    await Promise.all(
      organizations.map(async (org) => {
        const count = await eventRepository.countActiveByOrganization(org.id);
        activeEventsByOrgId.set(org.id, count);
      }),
    );

    return computePlanAnalytics({
      subscriptions,
      organizations,
      plans,
      activeEventsByOrgId,
      now: new Date(),
    });
  }

  // ── Bulk operations (T1.2 — admin bulk selection) ──────────────────────────
  //
  // The bulk endpoints intentionally delegate to the per-item methods
  // rather than opening a batch Firestore write: the single-item paths
  // already run the permission checks, the transactional read-write,
  // the audit emission, AND the Firebase Auth claim sync. Duplicating
  // that stack inside a batched write path would double the places where
  // we must keep the invariants in lockstep.
  //
  // Sequential execution (not Promise.all) is deliberate:
  //  - An errored item must NOT leak its Firestore write into the next
  //    item's transaction. Sequential keeps failures isolated.
  //  - Audit logs written out-of-order would confuse downstream consumers
  //    that sort by timestamp. Sequential preserves natural ordering.
  //  - Bounded to 100 ids per request (Zod-enforced at the edge) so the
  //    worst case is 100× the single-item latency ≈ a few seconds. Well
  //    within Cloud Run's 60s request budget.
  //
  // The response carries per-id success/failure — the UI renders a
  // summary "12 succeeded, 1 failed: reason" so the operator can retry
  // or investigate the failures without re-selecting from scratch.

  async bulkUpdateUserStatus(
    user: AuthUser,
    userIds: string[],
    isActive: boolean,
  ): Promise<{ succeeded: string[]; failed: Array<{ id: string; reason: string }> }> {
    this.requirePermission(user, "platform:manage");
    const succeeded: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const id of userIds) {
      try {
        await this.updateUserStatus(user, id, isActive);
        succeeded.push(id);
      } catch (err) {
        failed.push({
          id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { succeeded, failed };
  }

  async bulkUpdateOrgStatus(
    user: AuthUser,
    orgIds: string[],
    isActive: boolean,
  ): Promise<{ succeeded: string[]; failed: Array<{ id: string; reason: string }> }> {
    this.requirePermission(user, "platform:manage");
    const succeeded: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const id of orgIds) {
      try {
        await this.updateOrgStatus(user, id, isActive);
        succeeded.push(id);
      } catch (err) {
        failed.push({
          id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { succeeded, failed };
  }
}

export const adminService = new AdminService();
