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
  SUBSCRIPTIONS: "subscriptions",
  PLANS: "plans",
  SESSION_BOOKMARKS: "sessionBookmarks",
  COUNTERS: "counters",
} as const;
