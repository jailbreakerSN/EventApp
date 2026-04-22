import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { getMessaging } from "firebase-admin/messaging";

if (getApps().length === 0) {
  initializeApp();
}

export const db = getFirestore();
export const auth = getAuth();
export const storage = getStorage();
export const messaging = getMessaging();

export const COLLECTIONS = {
  USERS: "users",
  ORGANIZATIONS: "organizations",
  EVENTS: "events",
  SESSIONS: "sessions",
  REGISTRATIONS: "registrations",
  BADGES: "badges",
  BADGE_TEMPLATES: "badgeTemplates",
  PAYMENTS: "payments",
  RECEIPTS: "receipts",
  PAYOUTS: "payouts",
  BALANCE_TRANSACTIONS: "balanceTransactions",
  CONVERSATIONS: "conversations",
  MESSAGES: "messages",
  FEED_POSTS: "feedPosts",
  FEED_COMMENTS: "feedComments",
  NOTIFICATIONS: "notifications",
  NOTIFICATION_PREFERENCES: "notificationPreferences",
  OFFLINE_SYNC: "offlineSync",
  AUDIT_LOGS: "auditLogs",
  CHECKIN_FEED: "checkinFeed",
  CHECKINS: "checkins",
  CHECKIN_LOCKS: "checkinLocks",
  REFUND_LOCKS: "refundLocks",
  INVITES: "invites",
  BROADCASTS: "broadcasts",
  SMS_LOG: "smsLog",
  EMAIL_LOG: "emailLog",
  SPEAKERS: "speakers",
  SPONSORS: "sponsors",
  SPONSOR_LEADS: "sponsorLeads",
  PROMO_CODES: "promoCodes",
  VENUES: "venues",
  NEWSLETTER_SUBSCRIBERS: "newsletterSubscribers",
  EMAIL_SUPPRESSIONS: "emailSuppressions",
  SUBSCRIPTIONS: "subscriptions",
  PLANS: "plans",
  SESSION_BOOKMARKS: "sessionBookmarks",
  COUNTERS: "counters",
  // Notification system (Phase 5) — dispatch log populated by the API
  // service; the Resend webhook trigger backfills delivery status here
  // (bounced / complained → status="suppressed", reason="bounced").
  NOTIFICATION_DISPATCH_LOG: "notificationDispatchLog",
} as const;
