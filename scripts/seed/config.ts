/**
 * Shared configuration for seed scripts.
 *
 * Centralises what used to be duplicated between `seed-emulators.ts`,
 * `seed-qa-fixtures.ts`, and the newer reset command:
 *
 *   - Target detection  (`emulator` vs real Firestore project)
 *   - Project-id allow-list  — refuses unknown projects to prevent accidents
 *   - Date helpers          — centralises the past / live / upcoming offsets
 *                             used across events, registrations, sessions
 *   - City catalogue        — demo geography beyond Dakar
 *
 * Every script that touches production-scale Firebase MUST import and call
 * `assertSafeTarget()` before writing. This is the single chokepoint that
 * protects against typos like `FIREBASE_PROJECT_ID=teranga-events-prod`
 * combined with `SEED_TARGET=staging`.
 */

export const SEED_TARGET = (process.env.SEED_TARGET ?? "emulator") as "emulator" | "staging";
export const SEED_FORCE = process.env.SEED_FORCE === "true";
export const SEED_RESET_CONFIRM = process.env.SEED_RESET_CONFIRM ?? "";

// Default matches the historical seed target so existing local workflows
// keep working without explicit env vars.
export const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "teranga-app-990a8";

/**
 * Project IDs the seed / reset scripts are allowed to touch. Adding a new
 * environment = explicit code change + review — never a silent env-var
 * override. The production project is intentionally NOT in this list.
 */
const SEED_ALLOW_LIST = new Set([
  "teranga-app-990a8", // local dev + staging (shared project)
  "teranga-events-dev", // CI emulator-like project
]);

/** Human name used in log output and workflow-dispatch confirmations. */
export const PROJECT_LABEL: Record<string, string> = {
  "teranga-app-990a8": "local dev + staging",
  "teranga-events-dev": "CI dev",
};

/**
 * Panic-check called at script startup. Throws if:
 *   - `SEED_TARGET` is neither `emulator` nor `staging`
 *   - `FIREBASE_PROJECT_ID` is outside the allow-list
 *   - A reset operation is attempted without the exact confirmation token
 *
 * Must run BEFORE `initializeApp()` so a mis-typed project id never
 * connects to the wrong Firestore.
 */
export function assertSafeTarget(
  opts: {
    allowReset?: boolean;
  } = {},
): void {
  if (SEED_TARGET !== "emulator" && SEED_TARGET !== "staging") {
    throw new Error(`Invalid SEED_TARGET=${SEED_TARGET}. Must be "emulator" or "staging".`);
  }
  if (!SEED_ALLOW_LIST.has(PROJECT_ID)) {
    throw new Error(
      `FIREBASE_PROJECT_ID=${PROJECT_ID} is not in the seed allow-list. ` +
        `Allowed: ${[...SEED_ALLOW_LIST].join(", ")}. ` +
        `If you really need to seed this project, add it to SEED_ALLOW_LIST in scripts/seed/config.ts.`,
    );
  }
  if (opts.allowReset && SEED_RESET_CONFIRM !== "YES_RESET") {
    throw new Error(
      "Reset refused. Set SEED_RESET_CONFIRM=YES_RESET to proceed. " +
        "This is destructive and deletes ALL seed collections in " +
        `project ${PROJECT_ID}.`,
    );
  }
}

/** Configure the admin SDK to talk to local emulators (no-op in staging). */
export function configureEmulatorHosts(): void {
  if (SEED_TARGET === "emulator") {
    process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";
  }
}

// ─── Date helpers ────────────────────────────────────────────────────────────
// Every event / registration / session / payment in the seed uses offsets
// from "now" rather than hardcoded dates, so the same fixture data stays
// chronologically valid whether we seed today, next week, or in six months.

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const SEED_NOW = new Date();
const isoAt = (ms: number) => new Date(SEED_NOW.getTime() + ms).toISOString();

export const Dates = {
  now: SEED_NOW.toISOString(),

  // past — anchor for "happened already" demo content
  fifteenMinutesAgo: isoAt(-15 * 60 * 1000),
  twoHoursAgo: isoAt(-2 * HOUR_MS),
  oneHourAgo: isoAt(-HOUR_MS),
  yesterday: isoAt(-DAY_MS),
  twoDaysAgo: isoAt(-2 * DAY_MS),
  oneWeekAgo: isoAt(-7 * DAY_MS),
  twoWeeksAgo: isoAt(-14 * DAY_MS),
  oneMonthAgo: isoAt(-30 * DAY_MS),
  fortyFiveDaysAgo: isoAt(-45 * DAY_MS),
  threeMonthsAgo: isoAt(-90 * DAY_MS),

  // live / near-term — anchor for "currently running" demo content
  inOneHour: isoAt(HOUR_MS),
  inThreeHours: isoAt(3 * HOUR_MS),
  inFourHours: isoAt(4 * HOUR_MS),
  inSixHours: isoAt(6 * HOUR_MS),

  // upcoming — anchor for "future" demo content
  inTwoDays: isoAt(2 * DAY_MS),
  inThreeDays: isoAt(3 * DAY_MS),
  inFourDays: isoAt(4 * DAY_MS),
  inFiveDays: isoAt(5 * DAY_MS),
  inOneWeek: isoAt(7 * DAY_MS),
  inOneWeekPlus1h: isoAt(7 * DAY_MS + HOUR_MS),
  inOneWeekPlus2h: isoAt(7 * DAY_MS + 2 * HOUR_MS),
  inOneWeekPlus3h: isoAt(7 * DAY_MS + 3 * HOUR_MS),
  inOneWeekPlus4h: isoAt(7 * DAY_MS + 4 * HOUR_MS),
  inTenDays: isoAt(10 * DAY_MS),
  inTwoWeeks: isoAt(14 * DAY_MS),
  inThreeWeeks: isoAt(21 * DAY_MS),
  inOneMonth: isoAt(30 * DAY_MS),
  inFortyFiveDays: isoAt(45 * DAY_MS),
  inTwoMonths: isoAt(60 * DAY_MS),
  inSeventyFiveDays: isoAt(75 * DAY_MS),
  inThreeMonths: isoAt(90 * DAY_MS),
} as const;

/** Compose a datetime relative to seed start. Useful for ad-hoc offsets. */
export function atOffset(ms: number): string {
  return isoAt(ms);
}

// ─── City catalogue ──────────────────────────────────────────────────────────
// Seed coverage is deliberately multi-city to exercise the participant
// discovery UI (city filter, map pins, "events near you") with realistic
// francophone West African geography. Dakar remains the focal point.

export type SeedCity = {
  name: string;
  country: string;
  countryCode: string;
  timezone: string;
  region?: string;
  // Used for venue.coordinates when a venue is seeded in this city.
  coordinates: { lat: number; lng: number };
};

export const CITIES: Record<string, SeedCity> = {
  dakar: {
    name: "Dakar",
    country: "Sénégal",
    countryCode: "SN",
    region: "Dakar",
    timezone: "Africa/Dakar",
    coordinates: { lat: 14.6928, lng: -17.4467 },
  },
  saly: {
    name: "Saly",
    country: "Sénégal",
    countryCode: "SN",
    region: "Thiès",
    timezone: "Africa/Dakar",
    coordinates: { lat: 14.4417, lng: -17.0056 },
  },
  thies: {
    name: "Thiès",
    country: "Sénégal",
    countryCode: "SN",
    region: "Thiès",
    timezone: "Africa/Dakar",
    coordinates: { lat: 14.7886, lng: -16.9246 },
  },
  saintLouis: {
    name: "Saint-Louis",
    country: "Sénégal",
    countryCode: "SN",
    region: "Saint-Louis",
    timezone: "Africa/Dakar",
    coordinates: { lat: 16.0179, lng: -16.4896 },
  },
  ziguinchor: {
    name: "Ziguinchor",
    country: "Sénégal",
    countryCode: "SN",
    region: "Ziguinchor",
    timezone: "Africa/Dakar",
    coordinates: { lat: 12.5833, lng: -16.2719 },
  },
  abidjan: {
    name: "Abidjan",
    country: "Côte d'Ivoire",
    countryCode: "CI",
    region: "Abidjan",
    timezone: "Africa/Abidjan",
    coordinates: { lat: 5.3599, lng: -4.0083 },
  },
  bamako: {
    name: "Bamako",
    country: "Mali",
    countryCode: "ML",
    region: "Bamako",
    timezone: "Africa/Bamako",
    coordinates: { lat: 12.6392, lng: -8.0029 },
  },
  lome: {
    name: "Lomé",
    country: "Togo",
    countryCode: "TG",
    region: "Maritime",
    timezone: "Africa/Lome",
    coordinates: { lat: 6.1725, lng: 1.2314 },
  },
};

// ─── Shared collection list (used by reset) ──────────────────────────────────
// Keep in sync with apps/api/src/config/firebase.ts → COLLECTIONS.
// Ordered so child collections are deleted before parents where relevant
// (e.g. feedComments before feedPosts).

export const RESETTABLE_COLLECTIONS = [
  // Activity / ephemeral first
  "auditLogs",
  "notifications",
  "notificationPreferences",
  // ── Notification system v2 (Phases 1–5) ──────────────────────────
  // Append-only dispatch log + settings-history carry audit weight,
  // but in a local/staging reset we want them gone so tests start
  // with a clean slate. Production DO NOT reset — the seed-reset
  // script refuses to run against prod.
  "notificationDispatchLog",
  "notificationSettingsHistory",
  "notificationSettings",
  // Resend webhook bounce/complaint suppression list. Per email
  // doc id; resetting is safe in staging because the ops workflow
  // re-provisions clean state.
  "emailSuppressions",
  // Cloud Monitoring alert docs mirrored into Firestore by the
  // bounce-rate scheduled function (Phase 2.5). Top-level collection
  // has a single doc with nested `events/` sub-collection.
  "alerts",
  // Newsletter pipeline
  "newsletterSubscribers",
  "broadcasts",
  "messages",
  "conversations",
  "feedComments",
  "feedPosts",
  "sessionBookmarks",
  "checkinFeed",
  // Per-scan forensic records + uniqueness-enforcement locks.
  "checkins",
  "checkinLocks",
  // Refund serialisation locks. Reset-only in staging.
  "refundLocks",
  "offlineSync",
  "sponsorLeads",
  "smsLog",
  "emailLog",
  // Money
  "receipts",
  "payouts",
  "balanceTransactions",
  "payments",
  "promoCodes",
  // Structure
  "badges",
  "registrations",
  "sessions",
  "speakers",
  "sponsors",
  "events",
  "venues",
  "invites",
  "badgeTemplates",
  "subscriptions",
  "counters",
  // Phase 6 (admin overhaul) — platform feature flags. Stored as doc-per-
  // flag under a dedicated collection. Resettable in staging so flag
  // fixtures don't persist across seed runs; production deploys never
  // invoke the reset script so prod flags are safe.
  "featureFlags",
  // Phase D closure — admin ops surfaces. Reset in staging so demo
  // data (announcements + job-runs) doesn't leak across runs.
  "announcements",
  "adminJobRuns",
  // Identity last — deletes after everything that references users / orgs
  "users",
  "organizations",
  // NOTE: `plans` is intentionally NOT in this list. Plans are the system
  // catalog (free/starter/pro/enterprise) and are always idempotently re-
  // upserted by seed-plans.ts. Wiping them mid-reset would leave orgs
  // referencing a missing plan until the next upsert completes.
] as const;
