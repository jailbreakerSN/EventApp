/**
 * Seed Firebase Emulators with comprehensive test data for local development.
 *
 * Prerequisites:
 *   1. Firebase emulators running: `firebase emulators:start`
 *   2. Run: `npx tsx scripts/seed-emulators.ts`
 *
 * Creates:
 *   - 10 users (organizer, co-organizer, 2 participants, speaker, sponsor, super_admin, venue_manager, free_organizer, enterprise_organizer)
 *   - 4 organizations (pro event org, starter venue org, free org, enterprise org) — plan diversity for freemium testing
 *   - 3 venues (approved, pending, suspended) — Dakar locations
 *   - 4 events (published paid, published free, draft, cancelled) — 2 linked to venues
 *   - 6 registrations with varied statuses
 *   - 2 badges
 *   - 4 sessions for the conference
 *   - 3 feed posts with comments
 *   - 2 conversations with messages
 *   - 5 notifications
 *   - 2 payments (succeeded, pending)
 *   - 1 receipt
 *   - 2 speakers
 *   - 2 sponsors with 1 lead
 *   - 1 broadcast (sent)
 *   - 3 subscriptions (starter, pro, enterprise)
 *   - Notification preferences
 *   - Check-in feed entries
 *   - 12 audit logs (including admin + subscription actions)
 */

// ─── Safety guards ─────────────────────────────────────────────────────────
// All target detection, project-id allow-listing and emulator host wiring
// now lives in scripts/seed/config.ts. This script must assert safety BEFORE
// initializing the admin SDK — otherwise a typo in FIREBASE_PROJECT_ID would
// connect to the wrong Firestore before the guard runs.

import {
  PROJECT_ID,
  PROJECT_LABEL,
  SEED_FORCE,
  SEED_TARGET,
  assertSafeTarget,
  configureEmulatorHosts,
} from "./seed/config";

configureEmulatorHosts();
assertSafeTarget();

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { seedOrganizations } from "./seed/01-organizations";
import { seedUsers } from "./seed/02-users";
import { seedVenues } from "./seed/03-venues";
import { seedEvents } from "./seed/04-events";
import { seedActivity } from "./seed/05-activity";
import { seedSocial } from "./seed/06-social";
import { seedInvites } from "./seed/07-invites";

const app = initializeApp({ projectId: PROJECT_ID });
const auth = getAuth(app);
const db = getFirestore(app);

async function seed() {
  const label = PROJECT_LABEL[PROJECT_ID] ?? PROJECT_ID;
  console.log(
    `🌱 Seeding Firebase (target=${SEED_TARGET}, project=${PROJECT_ID}, label=${label})...\n`,
  );

  // ─── Always-run: plan catalog + effective-limits backfill ──────────────
  // These two steps are pure upserts / denormalization refreshes — safe to
  // run on every deploy regardless of whether the database is "empty" or
  // not. They MUST run before the idempotency guard below so that existing
  // staging/prod environments (which skip the rest of the seed) still get
  // the four system plans and fresh effective-limits snapshots.
  //
  // - seedPlans: upserts free/starter/pro/enterprise by deterministic key,
  //   preserving createdAt on re-run.
  // - backfillEffectiveLimits: recomputes effectiveLimits/Features for every
  //   org from the catalog + any subscription overrides. Idempotent.

  console.log("💼 Seeding plan catalog (always runs)...");
  {
    const { seedPlans } = await import("./seed-plans");
    const n = await seedPlans(db);
    console.log(`  ✓ ${n} system plans upserted (free, starter, pro, enterprise)`);
  }

  console.log("🔁 Backfilling effective plan limits on organizations (always runs)...");
  {
    const { backfillEffectiveLimits } = await import("./backfill-effective-limits");
    try {
      const result = await backfillEffectiveLimits(db);
      console.log(`  ✓ ${result.updated}/${result.total} organizations updated`);
      if (result.skipped > 0) {
        console.log(`  ⚠ ${result.skipped} skipped (missing plan in catalog):`);
        for (const entry of result.missingPlan) {
          console.log(`    - ${entry}`);
        }
      }
    } catch (err) {
      // A fresh project with zero organizations yet is fine — the backfill
      // throws only when the plans catalog is empty, which we just seeded
      // above. Any other error should surface.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("catalogue de plans est vide")) {
        console.log("  ⚠ Skipping backfill: catalog still empty (should never happen).");
      } else {
        throw err;
      }
    }
  }

  // ─── Idempotency guard ─────────────────────────────────────────────────
  // Only relevant in non-emulator mode: skip the rest of the seed if data
  // exists, unless forced. Emulator is ephemeral — always re-seed.
  // IMPORTANT: this guard must come AFTER the plan catalog and effective-
  // limits backfill so those steps reach production even when the rest of
  // the seed is skipped.
  if (SEED_TARGET !== "emulator" && !SEED_FORCE) {
    const existing = await db.collection("organizations").limit(1).get();
    if (!existing.empty) {
      console.log("\n✓ Database already contains organizations. Skipping remaining seed.");
      console.log("  Set SEED_FORCE=true to re-run the full seed (destructive).");
      return;
    }
    console.log("\n✓ Database is empty. Proceeding with initial seed.\n");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. USERS + PROFILES
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Auth users + Firestore profiles are created together by the seedUsers
  // module — see scripts/seed/02-users.ts. The module preserves the legacy
  // 13 fixtures byte-for-byte (including the role-coverage users added for
  // PR #59 and the intentionally profile-less `authOnlyUser`) and adds the
  // starter-org owner + 27 West African participant personas.

  console.log("👤 Creating users (auth + profiles)...");
  {
    const counts = await seedUsers(auth, db);
    console.log(
      `  ✓ ${counts.total} users (${counts.legacy} legacy + ${counts.expansion} expansion)`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. ORGANIZATIONS
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // 5 orgs — one per plan tier (free / starter / pro / enterprise) plus two
  // starter-tier orgs: the venue host (org-002 Dakar Venues) and the Thiès
  // Tech Collective (org-005, added in PR B to give the starter tier real
  // activity). See scripts/seed/01-organizations.ts.

  console.log("\n🏢 Creating organizations...");
  {
    const n = await seedOrganizations(db);
    console.log(`  ✓ ${n} organizations seeded`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. EVENTS
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // 20 events across categories / formats / plans / cities / lifecycle
  // buckets (past-completed / live / near-term / far-future). The legacy 4
  // events (event-001..004) stay byte-identical so inline sections 5-20
  // below keep resolving. See scripts/seed/04-events.ts.

  console.log("\n📅 Creating events...");
  {
    const n = await seedEvents(db);
    console.log(`  ✓ ${n} events seeded (4 legacy + 16 expansion)`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. VENUES
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // 14 venues across 8 francophone West African cities. The legacy 3 venues
  // (venue-001 CICAD, venue-002 Radisson Blu, venue-003 Jokkolabs) stay
  // byte-identical. See scripts/seed/03-venues.ts.

  console.log("\n📍 Creating venues...");
  {
    const n = await seedVenues(db);
    console.log(`  ✓ ${n} venues seeded (3 legacy + 11 expansion)`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. ACTIVITY (registrations, badges, sessions, speakers, sponsors,
  //    sponsor leads, payments, receipts)
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // The activity slice depends on events + users being written above. All
  // eight collections (previously inline sections 5-12) are now owned by
  // scripts/seed/05-activity.ts. Legacy fixtures are preserved byte-for-byte;
  // expansion fan-out across event-005..020 is delivered by the follow-up
  // commit on this branch (PR C stage 2).

  console.log("\n🎫 Creating activity fixtures...");
  {
    const c = await seedActivity(db);
    console.log(
      `  ✓ activity seeded — ${c.registrations} registrations, ${c.badges} badges, ` +
        `${c.sessions} sessions, ${c.sessionBookmarks} session bookmarks, ` +
        `${c.speakers} speakers, ${c.sponsors} sponsors, ` +
        `${c.sponsorLeads} leads, ${c.payments} payments, ${c.receipts} receipts, ` +
        `${c.balanceTransactions} ledger entries, ${c.payouts} payouts, ` +
        `${c.promoCodes} promo codes, ${c.badgeTemplates} badge templates`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. SOCIAL (feed, conversations, notifications, broadcasts, checkin feed,
  //    audit logs, subscriptions)
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // What used to be inline sections 13-20 is now owned by
  // scripts/seed/06-social.ts. Legacy fixtures preserved byte-for-byte.
  // Expansion social content (feed posts on LIVE events, welcome
  // notifications, audit entries on expansion events) lands in PR D stage 2
  // as pure additions to the named arrays inside the module.

  // ═══════════════════════════════════════════════════════════════════════════
  // 5b. INVITES (org membership onboarding — pending / accepted / expired)
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // The `invites` collection was never seeded before the Phase 1 seed refresh.
  // See scripts/seed/07-invites.ts — 10 invites across the 5 orgs, covering
  // all four lifecycle states and the three non-owner roles. Written here
  // after activity so the organisation + user references resolve.

  console.log("\n📨 Creating organisation invites...");
  {
    const n = await seedInvites(db);
    console.log(`  ✓ ${n} invites seeded (pending / accepted / declined / expired)`);
  }

  console.log("\n💬 Creating social + subscription fixtures...");
  {
    const s = await seedSocial(db);
    console.log(
      `  ✓ social seeded — ${s.feedPosts} posts, ${s.feedComments} comments, ` +
        `${s.conversations} conversations, ${s.messages} messages, ` +
        `${s.notifications} notifications, ${s.notificationPreferences} prefs, ` +
        `${s.notificationSettings} admin settings overrides, ` +
        `${s.notificationSettingsHistory} settings-history entries, ` +
        `${s.notificationDispatchLog} dispatch log entries, ` +
        `${s.broadcasts} broadcasts, ${s.checkinFeed} checkin feed, ` +
        `${s.auditLogs} audit logs, ${s.subscriptions} subscriptions, ` +
        `${s.emailSuppressions} email suppressions, ` +
        `${s.newsletterSubscribers} newsletter subscribers`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 20b. BACKFILL EFFECTIVE LIMITS (Phase 2 denormalization)
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // The always-runs block near the top of seed() also calls
  // backfillEffectiveLimits, but on a fresh seed that call sees zero orgs
  // (orgs are created later in this function). Re-run here so the 4 freshly
  // seeded orgs get their effective* fields populated. Idempotent — safe to
  // run multiple times.

  console.log("\n🔁 Backfilling effective plan limits onto freshly-seeded organizations...");
  const { backfillEffectiveLimits: backfillLate } = await import("./backfill-effective-limits");
  const backfill = await backfillLate(db);
  console.log(`  ✓ ${backfill.updated}/${backfill.total} organizations updated`);
  if (backfill.skipped > 0) {
    console.log(`  ⚠ ${backfill.skipped} skipped (missing plan in catalog):`);
    for (const entry of backfill.missingPlan) {
      console.log(`    - ${entry}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DONE
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n" + "═".repeat(60));
  console.log("✅ Seed complete! Data covers Waves 1-8 + Admin + Venues + Freemium.\n");
  console.log("📊 Summary:");
  console.log(
    "   Users:          10 (organizer, co-organizer, 2 participants, speaker, sponsor, super_admin, venue_manager, free_organizer, enterprise_organizer)",
  );
  console.log(
    "   Organizations:  4 (pro + starter + free + enterprise) — plan diversity for freemium testing",
  );
  console.log("   Subscriptions:  3 (starter, pro, enterprise — free has none)");
  console.log("   Venues:         3 (2 approved, 1 pending)");
  console.log("   Events:         4 (2 published, 1 draft, 1 cancelled) — 2 linked to venues");
  console.log("   Registrations:  6 (4 confirmed, 1 pending_payment, 1 checked-in)");
  console.log("   Badges:         2");
  console.log("   Sessions:       4 (keynote, workshop, panel, networking)");
  console.log("   Speakers:       2 (1 platform user, 1 external)");
  console.log("   Sponsors:       2 (gold + silver tier, 1 lead)");
  console.log("   Payments:       2 (1 succeeded, 1 pending) + 1 receipt");
  console.log("   Feed posts:     3 + 2 comments");
  console.log("   Conversations:  2 + 3 messages");
  console.log("   Notifications:  5 (2 read, 3 unread)");
  console.log("   Broadcasts:     1 (sent)");
  console.log("   Audit logs:     12 (including venue, admin & subscription actions)");
  console.log("");
  console.log("💳 Plan Distribution:");
  console.log(
    "   free:       Startup Dakar (org-003) — 3 events, 50 part/event, 1 member, no features",
  );
  console.log(
    "   starter:    Dakar Venues (org-002) — 10 events, 200 part/event, 3 members, QR+badges+CSV+promo",
  );
  console.log(
    "   pro:        Teranga Events (org-001) — unlimited events, 2000 part/event, 50 members, all except API+whitelabel",
  );
  console.log("   enterprise: Sonatel Events (org-004) — unlimited everything");
  console.log("");
  console.log("🔑 Login credentials:");
  console.log("   organizer@teranga.dev    / password123  (organizer, pro plan)");
  console.log("   coorganizer@teranga.dev  / password123  (co_organizer)");
  console.log("   participant@teranga.dev  / password123  (participant)");
  console.log("   participant2@teranga.dev / password123  (participant)");
  console.log("   speaker@teranga.dev      / password123  (speaker)");
  console.log("   sponsor@teranga.dev      / password123  (sponsor)");
  console.log("   admin@teranga.dev        / password123  (super_admin)");
  console.log("   venue@teranga.dev        / password123  (venue_manager, starter plan)");
  console.log("   free@teranga.dev         / password123  (organizer, free plan)");
  console.log("   enterprise@teranga.dev   / password123  (organizer, enterprise plan)");
  console.log("");
  console.log("🌐 URLs:");
  console.log("   API:              http://localhost:3000");
  console.log("   Web Backoffice:   http://localhost:3001");
  console.log("   Web Participant:  http://localhost:3002");
  console.log("   Emulator UI:      http://localhost:4000");
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
