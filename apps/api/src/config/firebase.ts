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
  INVITES: "invites",
  PAYMENTS: "payments",
  RECEIPTS: "receipts",
  PAYOUTS: "payouts",
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
  SESSION_BOOKMARKS: "sessionBookmarks",
  COUNTERS: "counters",
} as const;
