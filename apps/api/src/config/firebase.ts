import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { getMessaging } from "firebase-admin/messaging";
import { config } from "./index";

function initFirebaseAdmin() {
  if (getApps().length > 0) return;

  const useEmulators = !!process.env.FIRESTORE_EMULATOR_HOST;

  if (useEmulators) {
    // Emulators don't need real credentials
    initializeApp({
      projectId: config.FIREBASE_PROJECT_ID,
      storageBucket: config.FIREBASE_STORAGE_BUCKET,
    });
  } else {
    // Uses Workload Identity on GCP, GOOGLE_APPLICATION_CREDENTIALS locally
    initializeApp({
      credential: applicationDefault(),
      projectId: config.FIREBASE_PROJECT_ID,
      storageBucket: config.FIREBASE_STORAGE_BUCKET,
    });
  }
}

initFirebaseAdmin();

export const db = getFirestore();
export const auth = getAuth();
export const storage = getStorage();
export const messaging = getMessaging();

// ─── Firestore Collection References ─────────────────────────────────────────
export const COLLECTIONS = {
  USERS: "users",
  ORGANIZATIONS: "organizations",
  EVENTS: "events",
  SESSIONS: "sessions",
  REGISTRATIONS: "registrations",
  BADGES: "badges",
  BADGE_TEMPLATES: "badgeTemplates",
  CONVERSATIONS: "conversations",
  MESSAGES: "messages",
  FEED_POSTS: "feedPosts",
  FEED_COMMENTS: "feedComments",
  NOTIFICATIONS: "notifications",
  OFFLINE_SYNC: "offlineSync",
  AUDIT_LOGS: "auditLogs",
  CHECKIN_FEED: "checkinFeed",
  // Dedicated per-scan forensic collection. One doc per scan ATTEMPT
  // (success / duplicate / rejected). See badge-journey-review §3.3
  // for the design + migration strategy.
  CHECKINS: "checkins",
  // Uniqueness-enforcement lock docs for the scanPolicy machinery.
  // Doc id encodes the (registrationId, scope) pair — scope is either
  // the full registration (single), the zone id (multi_zone), or the
  // event-timezone day bucket (multi_day). Transactional exists-check
  // inside the scan path is what makes multi-entry correct under
  // concurrency. Admin-SDK-only at the rules layer.
  CHECKIN_LOCKS: "checkinLocks",
  // In-flight lock docs for refund serialisation. Doc id = paymentId.
  // Before calling the payment provider's refund API, the service
  // atomically creates a lock doc via `ref.create()`; if the create
  // throws ALREADY_EXISTS another refund for the same payment is
  // mid-flight, and the second caller gets a 409 before the provider
  // is hit a second time. Without this, two concurrent "Refund" clicks
  // both reach the provider and only the DB write deduplicates — the
  // provider records two refunds but our ledger shows one. Lock is
  // released inside the refund transaction (same commit as the ledger
  // write).
  REFUND_LOCKS: "refundLocks",
  INVITES: "invites",
  PAYMENTS: "payments",
  RECEIPTS: "receipts",
  PAYOUTS: "payouts",
  BALANCE_TRANSACTIONS: "balanceTransactions",
  BROADCASTS: "broadcasts",
  NOTIFICATION_PREFERENCES: "notificationPreferences",
  SMS_LOG: "smsLog",
  EMAIL_LOG: "emailLog",
  SPEAKERS: "speakers",
  SPONSORS: "sponsors",
  SPONSOR_LEADS: "sponsorLeads",
  PROMO_CODES: "promoCodes",
  VENUES: "venues",
  NEWSLETTER_SUBSCRIBERS: "newsletterSubscribers",
  // Written by the resendWebhook Cloud Function on email.bounced /
  // email.complained events. Doc id = lowercased email. Presence alone
  // means the address is suppressed — the document body carries the
  // reason + source event for auditing.
  EMAIL_SUPPRESSIONS: "emailSuppressions",
  SUBSCRIPTIONS: "subscriptions",
  PLANS: "plans",
  SESSION_BOOKMARKS: "sessionBookmarks",
  COUNTERS: "counters",
  // ─── Notification system (Phase 1) ─────────────────────────────────────
  // Per-notification-key admin overrides. Doc id = notification key
  // (e.g. "registration.created"). Body = NotificationSetting. Server-only
  // rules — super-admin writes flow through the admin notifications API
  // (Phase 4), never from the client. Absent doc = fall back to the
  // catalog's default channels + enabled=true.
  NOTIFICATION_SETTINGS: "notificationSettings",
  // Append-only dispatch log (Phase 5). Present as a COLLECTIONS constant
  // now so the Firestore rules and audit listener know about it even
  // though the writer (dispatcher's log-to-firestore option) lands in v2.
  NOTIFICATION_DISPATCH_LOG: "notificationDispatchLog",
  // Append-only edit history for NotificationSetting docs (Phase 2.4).
  // One entry per PUT (admin or organizer). TTL: 1 year target —
  // Firestore TTL config tracked as an infra follow-up.
  NOTIFICATION_SETTINGS_HISTORY: "notificationSettingsHistory",
  // Distributed rate-limit buckets (Phase D.4). Doc id =
  // `${scope}:${hashedIdentifier}:${windowStartBucket}` so concurrent
  // callers in the same (scope, identifier, window) triple land on the
  // same doc and a Firestore transaction gives us correct increments
  // across Cloud Run pods. Server-only; never seeded. TTL policy on
  // `expiresAt` auto-purges expired windows (see
  // infrastructure/firebase/firestore.ttl.md).
  RATE_LIMIT_BUCKETS: "rateLimitBuckets",
  // Phase 6 (admin overhaul) — platform feature flags. Doc id = flag
  // key (e.g. "new-checkin-flow"). Fields: { enabled: bool,
  // description?: string, rolloutPercent?: 0..100, updatedAt, updatedBy }.
  // Rules: deny-all at the client SDK; only super_admin via the API
  // may read/write.
  FEATURE_FLAGS: "featureFlags",
  // Phase D (closure) — platform-wide announcements shown as banners.
  // Doc id = announcement id. Super-admin only writes; clients read
  // via a dedicated public route that strips admin-only metadata.
  ANNOUNCEMENTS: "announcements",
  // Phase D — manual job-runs triggered from /admin/jobs. Each doc
  // records the triggering admin + status + timing for observability.
  ADMIN_JOB_RUNS: "adminJobRuns",
  // T2.2 — single-flight locks for the admin job runner. Doc id =
  // the jobKey itself (one lock per named handler). Transactional
  // `.create()` before the run starts; transactional delete in
  // finally. Stale locks (expiresAt < now) are auto-reclaimable so
  // a crashed handler can't wedge the job forever. Server-only at
  // the rules layer — Admin SDK writes exclusively.
  ADMIN_JOB_LOCKS: "adminJobLocks",
  // T2.1 — Payment webhook events log. One doc per received
  // (provider × transaction × status) triple. Persisted at receipt
  // time so operators can replay failed deliveries from
  // `/admin/webhooks`. Raw body kept for debugging / signature
  // re-verification; TTL 90 days via `firestoreTtlAt`. Server-only
  // writes — rules deny all client access.
  WEBHOOK_EVENTS: "webhookEvents",
  // Impersonation auth-code flow (OAuth-style short-lived codes).
  // Doc id = SHA-256 hex of the raw code. Body carries the target
  // uid + adminUid + targetOrigin + issuedAt + expiresAt + consumedAt
  // + audit metadata (IPs, UAs). TTL policy auto-purges on `expiresAt`;
  // see infrastructure/firebase/firestore.ttl.md. Server-only at the
  // rules layer — the Admin SDK reads/writes, clients are denied.
  IMPERSONATION_CODES: "impersonationCodes",
  // T2.3 — organization-scoped API keys. Doc id = `hashPrefix` (first
  // 10 chars of the plaintext `terk_*` key) so auth checks can resolve
  // in a single Firestore read. Body carries SHA-256(key) + metadata;
  // we NEVER store plaintext. Rules deny-all — Admin SDK writes only,
  // no client access path.
  API_KEYS: "apiKeys",
  // Plan-level coupons (Phase 7+ item #7). Code lookup via case-sensitive
  // doc id (code is uppercase-only per `PlanCouponCodeSchema`, so a
  // single query hits the right doc). `appliedPlanIds` / `appliedCycles`
  // scope + `expiresAt` / `maxUses` gates are all enforced inside the
  // upgrade transaction — see `plan-coupon.service.ts`.
  PLAN_COUPONS: "planCoupons",
  // Redemption audit trail + per-org cap enforcement. One doc per
  // successful redemption. Queried by `(organizationId, couponId)` to
  // enforce `maxUsesPerOrg`. Server-only at the rules layer.
  COUPON_REDEMPTIONS: "couponRedemptions",
  // Sprint-3 T4.2 — Firestore read-volume tracking, one doc per
  // (org, day) bucket. Doc id = `${orgId}_${YYYY-MM-DD}` so the
  // single-doc upsert path is O(1). Field `reads` is a monotonic
  // counter bumped via `FieldValue.increment` after each request
  // by the read-tracking flush hook. Server-only at the rules
  // layer — operators read it via the admin endpoint, never
  // directly via Firestore.
  FIRESTORE_USAGE: "firestoreUsage",
  // Sprint-4 T3.2 — recurring admin operations. Each doc binds a
  // registered job key + cron schedule + frozen input payload.
  // A Cloud Functions scheduled trigger (every 5 min) reads
  // docs where `enabled=true AND nextRunAt <= now` and dispatches
  // them into the existing admin job runner. Server-only at the
  // rules layer — operators CRUD via /admin/scheduled-ops.
  SCHEDULED_ADMIN_OPS: "scheduledAdminOps",
} as const;
