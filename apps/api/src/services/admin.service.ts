import { BaseService } from "./base.service";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { adminRepository } from "@/repositories/admin.repository";
import { venueRepository } from "@/repositories/venue.repository";
import { planRepository } from "@/repositories/plan.repository";
import { db, auth, COLLECTIONS } from "@/config/firebase";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { NotFoundError, ForbiddenError } from "@/errors/app-error";
import { rateLimit } from "./rate-limit.service";
import type {
  PlatformStats,
  PlanAnalytics,
  AdminUserQuery,
  AdminOrgQuery,
  AdminEventQuery,
  AdminAuditQuery,
  AdminUserRow,
  ClaimsMatch,
  UserProfile,
  Organization,
  Event,
  AuditLogEntry,
  Plan,
  Subscription,
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
    this.requirePermission(user, "platform:manage");
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

    const csvCell = (v: unknown): string => {
      if (v == null) return "";
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
      category: "moderation" | "accounts" | "billing" | "ops" | "events_live";
      severity: "info" | "warning" | "critical";
      title: string;
      description: string;
      count: number;
      href: string;
    }>;
    computedAt: string;
  }> {
    this.requirePermission(user, "platform:manage");

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

    const [
      pendingVenues,
      unverifiedOrgs,
      pendingPayments,
      pastDueSubs,
      failedPayments,
      expiredInvites,
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
    ]);

    const signals: Array<{
      id: string;
      category: "moderation" | "accounts" | "billing" | "ops" | "events_live";
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
        // `/admin/subscriptions` is the canonical subscriptions surface
        // (closure F). Previously the href went to `/admin/organizations`
        // without any filter — the admin would land on the full org list
        // with no link between the signal count and what they saw.
        href: "/admin/subscriptions",
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
        href: "/admin/audit?action=payment.failed",
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
        href: "/admin/organizations",
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
    this.requirePermission(user, "platform:manage");
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
  ): Promise<{
    customToken: string;
    targetUid: string;
    targetDisplayName: string | null;
    targetEmail: string | null;
    expiresAt: string;
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
    // generous for legitimate customer-success workflows.
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

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const customToken = await auth.createCustomToken(targetUid, {
      // Stamp the original actor onto the minted token. The ID token
      // exchanged client-side will carry these as custom claims.
      impersonatedBy: user.uid,
      impersonationExpiresAt: expiresAt,
      // Carry the target's real roles so downstream RBAC works.
      roles: targetProfile.roles ?? [],
      organizationId: targetProfile.organizationId ?? null,
      orgRole: targetProfile.orgRole ?? null,
    });

    // Audit log — synchronous so the trail is visible before the UI
    // even gets the token. If the audit write fails, the impersonation
    // doesn't proceed.
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
        expiresAt,
      },
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
    });

    // Emit a domain event so downstream listeners (e.g. security alerts)
    // can react to impersonation usage in near-real-time.
    eventBus.emit("user.impersonated", {
      actorUid: user.uid,
      targetUid,
      expiresAt,
    });

    return {
      customToken,
      targetUid,
      targetDisplayName: targetProfile.displayName ?? null,
      targetEmail: targetProfile.email ?? null,
      expiresAt,
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
    this.requirePermission(user, "platform:manage");
    const doc = await db.collection(COLLECTIONS.USERS).doc(targetUid).get();
    if (!doc.exists) {
      throw new NotFoundError("User", targetUid);
    }
    const profile = { uid: targetUid, ...doc.data() } as UserProfile;
    return this.attachClaimsMatch(profile);
  }

  async listUsers(user: AuthUser, query: AdminUserQuery): Promise<PaginatedResult<AdminUserRow>> {
    this.requirePermission(user, "platform:manage");
    const page = await adminRepository.listAllUsers(
      { q: query.q, role: query.role, isActive: query.isActive },
      { page: query.page, limit: query.limit },
    );

    // Enrich each row with a JWT ↔ Firestore drift check. Admin UI
    // displays a visible warning on rows where the two disagree so
    // operators don't apply mutations against stale state (see the
    // `AdminUserRow` type comment in shared-types). Bounded cardinality
    // — admin table pages at 20 rows — so N+1 `auth.getUser` is
    // acceptable. Batching via `auth.getUsers([...])` would be cleaner
    // but firebase-admin's batch identifier interface is clunky for
    // our pagination pattern; defer until this becomes a latency issue.
    const enriched = await Promise.all(
      page.data.map(async (u): Promise<AdminUserRow> => this.attachClaimsMatch(u)),
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

    try {
      const record = await auth.getUser(profile.uid);
      const rawClaims = record.customClaims;
      const claims = (rawClaims ?? {}) as Record<string, unknown>;

      // Fresh-user grace window: if Auth has NO custom claims set yet
      // (undefined or empty object) AND the Firestore doc was created
      // less than CLAIMS_PROPAGATION_GRACE_MS ago, treat the two as in
      // sync. Rationale: the onUserCreated Cloud Function trigger sets
      // the initial claims asynchronously, so a brand-new account that
      // hasn't had its first claim-write yet will otherwise light up
      // a false-positive drift pill every single time. We don't want
      // operators to develop habituation to a warning they should
      // actually act on.
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
    } catch {
      // Auth fetch failed — surface visually via claimsMatch: null
      // rather than hiding the row or throwing. The admin can still
      // operate on the row and will see the warning badge.
      return { ...base, claimsMatch: null };
    }
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

  // ── Organization Management ───────────────────────────────────────────

  async listOrganizations(
    user: AuthUser,
    query: AdminOrgQuery,
  ): Promise<PaginatedResult<Organization>> {
    this.requirePermission(user, "platform:manage");
    return adminRepository.listAllOrganizations(
      { q: query.q, plan: query.plan, isVerified: query.isVerified, isActive: query.isActive },
      { page: query.page, limit: query.limit },
    );
  }

  async verifyOrganization(user: AuthUser, orgId: string): Promise<void> {
    this.requirePermission(user, "platform:manage");

    const orgDoc = await db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId).get();
    if (!orgDoc.exists) throw new NotFoundError("Organization", orgId);

    await db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId).update({
      isVerified: true,
      updatedAt: new Date().toISOString(),
    });

    eventBus.emit("organization.verified", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
      organizationId: orgId,
    });
  }

  async updateOrgStatus(user: AuthUser, orgId: string, isActive: boolean): Promise<void> {
    this.requirePermission(user, "platform:manage");

    const orgDoc = await db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId).get();
    if (!orgDoc.exists) throw new NotFoundError("Organization", orgId);

    await db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId).update({
      isActive,
      updatedAt: new Date().toISOString(),
    });

    eventBus.emit("organization.status_changed", {
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: new Date().toISOString(),
      organizationId: orgId,
      isActive,
    });
  }

  // ── Event Oversight ───────────────────────────────────────────────────

  async listEvents(user: AuthUser, query: AdminEventQuery): Promise<PaginatedResult<Event>> {
    this.requirePermission(user, "platform:manage");
    return adminRepository.listAllEvents(
      { q: query.q, status: query.status, organizationId: query.organizationId },
      { page: query.page, limit: query.limit },
    );
  }

  // ── Audit Logs ────────────────────────────────────────────────────────

  async listAuditLogs(
    user: AuthUser,
    query: AdminAuditQuery,
  ): Promise<PaginatedResult<AuditLogEntry>> {
    this.requirePermission(user, "platform:manage");
    return adminRepository.listAuditLogs(
      {
        action: query.action,
        actorId: query.actorId,
        resourceType: query.resourceType,
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
