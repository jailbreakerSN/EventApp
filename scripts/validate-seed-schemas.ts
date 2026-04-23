/**
 * Drift detection utility — validates seed fixtures against Zod schemas.
 *
 * This is a one-off, non-destructive tool for Phase 0 of the seed-data
 * refresh (see docs/seed/README.md). It does NOT write to Firestore.
 *
 * It short-circuits the typical seed pipeline by instantiating an in-memory
 * Firestore shim, capturing every call to `collection().doc().set()` (and
 * `.create()`, `.setDoc()`, `runTransaction`), and then running each captured
 * document through the matching Zod schema. Any drift between the fixture
 * shape and the current schema surface is reported as a per-collection
 * error summary.
 *
 * Usage:
 *   npx tsx scripts/validate-seed-schemas.ts
 *
 * Exit codes:
 *   0 — every fixture parses
 *   1 — at least one fixture does not parse
 *
 * Implementation notes:
 *   - We do not mock Auth — users are written via admin.auth().createUser(),
 *     which is exercised in a separate pipeline. This script only validates
 *     Firestore-bound fixtures.
 *   - We tolerate schema omissions (fields not yet added to Zod): missing
 *     top-level `coverURL` is NOT an error if the schema marks it optional.
 *   - We report the first 3 issues per collection (sample) plus a total.
 */

import { type z } from "zod";

// ─── Schemas we validate against ─────────────────────────────────────────────
import {
  OrganizationSchema,
  OrganizationInviteSchema,
  UserProfileSchema,
  EventSchema,
  SessionSchema,
  RegistrationSchema,
  GeneratedBadgeSchema,
  BadgeTemplateSchema,
  PaymentSchema,
  ReceiptSchema,
  PayoutSchema,
  BalanceTransactionSchema,
  PromoCodeSchema,
  VenueSchema,
  SpeakerProfileSchema,
  SponsorProfileSchema,
  SponsorLeadSchema,
  SubscriptionSchema,
  PlanSchema,
  NotificationSettingSchema,
  NotificationSettingHistorySchema,
  AuditLogEntrySchema,
  BroadcastSchema,
  MessageSchema,
  ConversationSchema,
  FeedPostSchema,
  FeedCommentSchema,
  NotificationSchema,
} from "@teranga/shared-types";

type CapturedWrite = { id: string; data: unknown };

// ─── In-memory Firestore shim ────────────────────────────────────────────────
// We only need to capture writes; queries, reads, transactions, and batched
// writes must behave like permissive no-ops so the seed modules run to
// completion. Collections we don't validate below are still captured so the
// summary reports their counts.

const writesByCollection = new Map<string, CapturedWrite[]>();

function record(collection: string, id: string, data: unknown): void {
  const list = writesByCollection.get(collection) ?? [];
  list.push({ id, data });
  writesByCollection.set(collection, list);
}

function makeDocRef(collection: string, id: string): Record<string, unknown> {
  return {
    id,
    path: `${collection}/${id}`,
    set: async (data: unknown) => {
      record(collection, id, data);
      return { writeTime: new Date() };
    },
    update: async (data: unknown) => {
      // Merge into existing record for validation
      const list = writesByCollection.get(collection) ?? [];
      const existing = list.find((w) => w.id === id);
      if (existing) {
        existing.data = { ...(existing.data as object), ...(data as object) };
      } else {
        record(collection, id, data);
      }
      return { writeTime: new Date() };
    },
    get: async () => ({
      exists: false,
      data: () => undefined,
      id,
    }),
    create: async (data: unknown) => {
      record(collection, id, data);
      return { writeTime: new Date() };
    },
    collection: (subcol: string) => makeCollectionRef(`${collection}/${id}/${subcol}`),
  };
}

function makeCollectionRef(collection: string): Record<string, unknown> {
  return {
    id: collection,
    path: collection,
    doc: (id?: string) =>
      makeDocRef(collection, id ?? `auto-${Math.random().toString(36).slice(2)}`),
    add: async (data: unknown) => {
      const id = `auto-${Math.random().toString(36).slice(2)}`;
      record(collection, id, data);
      return makeDocRef(collection, id);
    },
    where: () => makeCollectionRef(collection),
    orderBy: () => makeCollectionRef(collection),
    limit: () => makeCollectionRef(collection),
    get: async () => ({ empty: true, docs: [], size: 0, forEach: () => {} }),
    // For queries that iterate — emulate empty result set
    [Symbol.asyncIterator]: async function* () {
      /* yield nothing */
    },
  };
}

const fakeBatch = {
  set: (ref: { path: string; id: string }, data: unknown) => {
    const [collection] = ref.path.split("/");
    record(collection, ref.id, data);
    return fakeBatch;
  },
  create: (ref: { path: string; id: string }, data: unknown) => {
    const [collection] = ref.path.split("/");
    record(collection, ref.id, data);
    return fakeBatch;
  },
  update: (ref: { path: string; id: string }, data: unknown) => {
    const [collection] = ref.path.split("/");
    record(collection, ref.id, data);
    return fakeBatch;
  },
  delete: () => fakeBatch,
  commit: async () => [],
};

const fakeDb = {
  collection: (name: string) => makeCollectionRef(name),
  batch: () => fakeBatch,
  runTransaction: async (fn: (tx: unknown) => unknown) => {
    const fakeTx = {
      get: async () => ({ exists: false, data: () => undefined }),
      set: (ref: { path: string; id: string }, data: unknown) => {
        const [collection] = ref.path.split("/");
        record(collection, ref.id, data);
        return fakeTx;
      },
      update: (ref: { path: string; id: string }, data: unknown) => {
        const [collection] = ref.path.split("/");
        record(collection, ref.id, data);
        return fakeTx;
      },
      create: (ref: { path: string; id: string }, data: unknown) => {
        const [collection] = ref.path.split("/");
        record(collection, ref.id, data);
        return fakeTx;
      },
      delete: () => fakeTx,
    };
    return await fn(fakeTx);
  },
};

const fakeAuth = {
  createUser: async (u: { uid: string }) => ({ uid: u.uid, ...u }),
  getUser: async () => {
    throw Object.assign(new Error("not found"), { code: "auth/user-not-found" });
  },
  updateUser: async (uid: string, updates: Record<string, unknown>) => ({ uid, ...updates }),
  setCustomUserClaims: async () => undefined,
  deleteUser: async () => undefined,
};

// ─── Schema registry ─────────────────────────────────────────────────────────
// For each collection, which schema should docs parse against?
// Entries commented "permissive" intentionally skip strict validation for
// now (free-form reference docs, runtime-only logs seeded for demo).

const REGISTRY: Record<string, z.ZodTypeAny | null> = {
  organizations: OrganizationSchema,
  invites: OrganizationInviteSchema,
  users: UserProfileSchema,
  events: EventSchema,
  sessions: SessionSchema,
  registrations: RegistrationSchema,
  badges: GeneratedBadgeSchema,
  badgeTemplates: BadgeTemplateSchema,
  payments: PaymentSchema,
  receipts: ReceiptSchema,
  payouts: PayoutSchema,
  balanceTransactions: BalanceTransactionSchema,
  promoCodes: PromoCodeSchema,
  venues: VenueSchema,
  speakers: SpeakerProfileSchema,
  sponsors: SponsorProfileSchema,
  sponsorLeads: SponsorLeadSchema,
  subscriptions: SubscriptionSchema,
  plans: PlanSchema,
  notificationSettings: NotificationSettingSchema,
  notificationSettingsHistory: NotificationSettingHistorySchema,
  auditLogs: AuditLogEntrySchema,
  broadcasts: BroadcastSchema,
  messages: MessageSchema,
  conversations: ConversationSchema,
  feedPosts: FeedPostSchema,
  feedComments: FeedCommentSchema,
  notifications: NotificationSchema,
  // Permissive (no strict schema enforced here — collection has no dedicated
  // Zod schema in @teranga/shared-types, so fixtures are validated only
  // through downstream consumers at runtime)
  notificationPreferences: null,
  emailSuppressions: null,
  newsletterSubscribers: null,
  counters: null,
  checkinFeed: null,
  checkins: null,
  checkinLocks: null,
  offlineSync: null,
  smsLog: null,
  emailLog: null,
  refundLocks: null,
  notificationDispatchLog: null,
  alerts: null,
  rateLimitBuckets: null,
  sessionBookmarks: null,
};

async function main(): Promise<void> {
  // Importing seed modules AFTER we install the shim guarantees they pick up
  // the fakeDb. We pass fakeDb directly into each exported seeder.

  const { seedOrganizations } = await import("./seed/01-organizations");
  const { seedUsers } = await import("./seed/02-users");
  const { seedVenues } = await import("./seed/03-venues");
  const { seedEvents } = await import("./seed/04-events");
  const { seedActivity } = await import("./seed/05-activity");
  const { seedSocial } = await import("./seed/06-social");
  const { seedInvites } = await import("./seed/07-invites");
  const { seedPlans } = await import("./seed-plans");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await seedOrganizations(fakeDb as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await seedUsers(fakeAuth as any, fakeDb as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await seedVenues(fakeDb as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await seedEvents(fakeDb as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await seedActivity(fakeDb as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await seedSocial(fakeDb as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await seedInvites(fakeDb as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await seedPlans(fakeDb as any);

  console.log("\n─── DRIFT DETECTION REPORT ─────────────────────────────────────\n");

  let totalErrors = 0;
  const collections = [...writesByCollection.keys()].sort();

  for (const col of collections) {
    const docs = writesByCollection.get(col) ?? [];
    const schema = REGISTRY[col];
    if (schema === undefined) {
      console.log(`⚠  ${col.padEnd(32)} ${docs.length} docs — NO SCHEMA MAPPED`);
      continue;
    }
    if (schema === null) {
      console.log(`·  ${col.padEnd(32)} ${docs.length} docs — permissive (no check)`);
      continue;
    }
    const failures: { id: string; issues: string[] }[] = [];
    for (const doc of docs) {
      const result = schema.safeParse(doc.data);
      if (!result.success) {
        failures.push({
          id: doc.id,
          issues: result.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
        });
      }
    }
    if (failures.length === 0) {
      console.log(`✓  ${col.padEnd(32)} ${docs.length} docs — OK`);
    } else {
      totalErrors += failures.length;
      console.log(`✗  ${col.padEnd(32)} ${docs.length} docs — ${failures.length} FAILED`);
      for (const f of failures.slice(0, 3)) {
        console.log(`     [${f.id}]`);
        for (const issue of f.issues) console.log(`       · ${issue}`);
      }
      if (failures.length > 3) {
        console.log(`     ... (${failures.length - 3} more)`);
      }
    }
  }

  console.log("\n─────────────────────────────────────────────────────────────────");
  if (totalErrors === 0) {
    console.log("✅ No drift detected.");
    process.exit(0);
  } else {
    console.log(`❌ ${totalErrors} fixture(s) failed validation.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("💥 Validator crashed:", err);
  process.exit(2);
});
