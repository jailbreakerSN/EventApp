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

// ─── Mode detection ────────────────────────────────────────────────────────
// Defaults to emulator mode for safety. Set SEED_TARGET=staging (or any other
// non-empty value) to seed against a real Firestore project.
//   - emulator: writes to local Firebase emulators (default)
//   - staging:  writes to real Firestore. Requires GOOGLE_APPLICATION_CREDENTIALS
//               or Application Default Credentials (set automatically by
//               google-github-actions/auth in CI). Checks idempotency before
//               writing, unless SEED_FORCE=true.

const SEED_TARGET = process.env.SEED_TARGET ?? "emulator";
const SEED_FORCE = process.env.SEED_FORCE === "true";
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "teranga-app-990a8";

if (SEED_TARGET === "emulator") {
  process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";
}

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const app = initializeApp({ projectId: PROJECT_ID });
const auth = getAuth(app);
const db = getFirestore(app);

// ─── Time helpers ──────────────────────────────────────────────────────────

const now = new Date().toISOString();
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const inOneWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const inOneWeekPlus1h = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 3600000).toISOString();
const inOneWeekPlus2h = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 7200000).toISOString();
const inOneWeekPlus3h = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 10800000).toISOString();
const inOneWeekPlus4h = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 14400000).toISOString();
const inTwoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
const inOneMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

// ─── IDs ─────────────────────────────────────────────────────────────────

const IDS = {
  orgId: "org-001",
  venueOrgId: "org-002",
  freeOrgId: "org-003",
  enterpriseOrgId: "org-004",
  // Users
  organizer: "organizer-uid-001",
  coOrganizer: "coorg-uid-001",
  participant1: "participant-uid-001",
  participant2: "participant-uid-002",
  speakerUser: "speaker-uid-001",
  sponsorUser: "sponsor-uid-001",
  superAdmin: "superadmin-uid-001",
  venueManager: "venuemanager-uid-001",
  freeOrganizer: "freeorg-uid-001",
  enterpriseOrganizer: "enterprise-uid-001",
  // Role-coverage fixtures added for PR #59 (fix: onUserCreated race) —
  // each one validates a different branch of the role-display contract
  // in the admin users table at /admin/users.
  //   - `staffUser`: the only `staff` role in the platform, closes a
  //     regression gap where no seeded user carried that role at all.
  //   - `multiRoleUser`: carries two roles (organizer + speaker) — common
  //     real-world shape (an organizer who also speaks at their own
  //     event) and proves the admin UI renders the FULL `roles[]` array,
  //     not just `roles[0]`.
  //   - `authOnlyUser`: created via auth.createUser without a companion
  //     Firestore profile write — exercises the trigger's "no existing
  //     profile → default to participant" path. The admin UI should show
  //     this one with the Participant badge, which is the ONE row where
  //     that label is semantically correct.
  staffUser: "staff-uid-001",
  multiRoleUser: "multirole-uid-001",
  authOnlyUser: "authonly-uid-001",
  // Events
  conference: "event-001",
  workshop: "event-002",
  meetup: "event-003",
  paidEvent: "event-004",
  // Registrations
  reg1: "reg-001",
  reg2: "reg-002",
  reg3: "reg-003",
  reg4: "reg-004",
  reg5: "reg-005",
  reg6: "reg-006",
  // Sessions
  session1: "session-001",
  session2: "session-002",
  session3: "session-003",
  session4: "session-004",
  // Speakers
  speaker1: "speaker-001",
  speaker2: "speaker-002",
  // Sponsors
  sponsor1: "sponsor-001",
  sponsor2: "sponsor-002",
  // Payments
  payment1: "payment-001",
  payment2: "payment-002",
  // Feed
  post1: "post-001",
  post2: "post-002",
  post3: "post-003",
  comment1: "comment-001",
  comment2: "comment-002",
  // Conversations
  conv1: "conv-001",
  conv2: "conv-002",
  // Broadcasts
  broadcast1: "broadcast-001",
  // Venues
  venue1: "venue-001",
  venue2: "venue-002",
  venue3: "venue-003",
};

/** Create or retrieve a user — idempotent (safe to re-run). */
async function ensureUser(
  uid: string,
  props: { email: string; password: string; displayName: string; phoneNumber?: string },
  claims: Record<string, unknown>,
) {
  try {
    await auth.createUser({ uid, ...props, emailVerified: true });
  } catch (err: any) {
    if (err?.errorInfo?.code !== "auth/uid-already-exists") throw err;
    await auth.updateUser(uid, { displayName: props.displayName });
  }
  await auth.setCustomUserClaims(uid, claims);
  return { uid };
}

async function seed() {
  console.log(`🌱 Seeding Firebase (target=${SEED_TARGET}, project=${PROJECT_ID})...\n`);

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
  // 1. USERS
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("👤 Creating users...");

  await ensureUser(
    IDS.organizer,
    { email: "organizer@teranga.dev", password: "password123", displayName: "Moussa Diop" },
    { roles: ["organizer"], organizationId: IDS.orgId },
  );

  await ensureUser(
    IDS.coOrganizer,
    { email: "coorganizer@teranga.dev", password: "password123", displayName: "Fatou Sall" },
    { roles: ["co_organizer"], organizationId: IDS.orgId },
  );

  await ensureUser(
    IDS.participant1,
    { email: "participant@teranga.dev", password: "password123", displayName: "Aminata Fall" },
    { roles: ["participant"] },
  );

  await ensureUser(
    IDS.participant2,
    { email: "participant2@teranga.dev", password: "password123", displayName: "Ousmane Ndiaye" },
    { roles: ["participant"] },
  );

  await ensureUser(
    IDS.speakerUser,
    { email: "speaker@teranga.dev", password: "password123", displayName: "Ibrahima Gueye" },
    { roles: ["speaker"] },
  );

  await ensureUser(
    IDS.sponsorUser,
    { email: "sponsor@teranga.dev", password: "password123", displayName: "Aissatou Ba" },
    { roles: ["sponsor"] },
  );

  await ensureUser(
    IDS.superAdmin,
    { email: "admin@teranga.dev", password: "password123", displayName: "Abdoulaye Sarr" },
    { roles: ["super_admin"] },
  );

  await ensureUser(
    IDS.venueManager,
    { email: "venue@teranga.dev", password: "password123", displayName: "Khady Niang" },
    { roles: ["venue_manager"], organizationId: IDS.venueOrgId },
  );

  await ensureUser(
    IDS.freeOrganizer,
    { email: "free@teranga.dev", password: "password123", displayName: "Djibril Mbaye" },
    { roles: ["organizer"], organizationId: IDS.freeOrgId },
  );

  await ensureUser(
    IDS.enterpriseOrganizer,
    { email: "enterprise@teranga.dev", password: "password123", displayName: "Mame Diarra Seck" },
    { roles: ["organizer"], organizationId: IDS.enterpriseOrgId },
  );

  // ─── Role-coverage fixtures for PR #59 (onUserCreated race fix) ────────
  // Covers three cases the pre-existing roster didn't exercise. After
  // seeding, visit /admin/users and confirm each row shows its real role
  // badge (no more "Participant" for everyone).

  // 1. `staff` — QR check-in agent role. Not seeded before.
  await ensureUser(
    IDS.staffUser,
    { email: "staff@teranga.dev", password: "password123", displayName: "Moussa Sy" },
    { roles: ["staff"], organizationId: IDS.orgId },
  );

  // 2. Multi-role user (organizer + speaker) — the admin UI renders the
  // full `roles[]` array; this row exposes any "only first role wins"
  // regression. Common IRL shape: an organizer who also speaks at their
  // own event.
  await ensureUser(
    IDS.multiRoleUser,
    { email: "multirole@teranga.dev", password: "password123", displayName: "Khadija Diop" },
    { roles: ["organizer", "speaker"], organizationId: IDS.orgId },
  );

  // 3. Auth-only user — created via auth.createUser with NO companion
  // Firestore profile write below. Exercises the trigger's "no existing
  // profile → default to participant" path. This is the ONE row in the
  // admin table where the Participant badge is semantically correct
  // (fresh signup with no provisioning metadata).
  await ensureUser(
    IDS.authOnlyUser,
    { email: "authonly@teranga.dev", password: "password123", displayName: "Thierno Wade" },
    {}, // no custom claims — trigger's default is what we're validating
  );

  console.log("  ✓ organizer@teranga.dev / password123 (organizer, pro plan)");
  console.log("  ✓ coorganizer@teranga.dev / password123 (co_organizer)");
  console.log("  ✓ participant@teranga.dev / password123 (participant)");
  console.log("  ✓ participant2@teranga.dev / password123 (participant)");
  console.log("  ✓ speaker@teranga.dev / password123 (speaker)");
  console.log("  ✓ sponsor@teranga.dev / password123 (sponsor)");
  console.log("  ✓ admin@teranga.dev / password123 (super_admin)");
  console.log("  ✓ venue@teranga.dev / password123 (venue_manager, starter plan)");
  console.log("  ✓ free@teranga.dev / password123 (organizer, free plan)");
  console.log("  ✓ enterprise@teranga.dev / password123 (organizer, enterprise plan)");
  console.log("  ✓ staff@teranga.dev / password123 (staff — PR #59 fixture)");
  console.log("  ✓ multirole@teranga.dev / password123 (organizer+speaker — PR #59 fixture)");
  console.log(
    "  ✓ authonly@teranga.dev / password123 (auth-only, default participant — PR #59 fixture)",
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. ORGANIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n🏢 Creating organization...");

  await db
    .collection("organizations")
    .doc(IDS.orgId)
    .set({
      id: IDS.orgId,
      name: "Teranga Events",
      slug: "teranga-events",
      description: "Organisateur d'événements tech au Sénégal",
      logoURL: null,
      website: "https://teranga.events",
      contactEmail: "contact@teranga.events",
      phone: "+221770001234",
      country: "SN",
      city: "Dakar",
      plan: "pro",
      ownerId: IDS.organizer,
      memberIds: [IDS.organizer, IDS.coOrganizer],
      isVerified: true,
      isActive: true,
      createdAt: twoDaysAgo,
      updatedAt: now,
    });

  // Organization 2: Venue host org
  await db
    .collection("organizations")
    .doc(IDS.venueOrgId)
    .set({
      id: IDS.venueOrgId,
      name: "Dakar Venues & Hospitality",
      slug: "dakar-venues",
      description: "Gestionnaire de lieux d'événements premium à Dakar",
      logoURL: null,
      website: "https://dakar-venues.sn",
      contactEmail: "contact@dakar-venues.sn",
      phone: "+221770004321",
      country: "SN",
      city: "Dakar",
      plan: "starter",
      ownerId: IDS.venueManager,
      memberIds: [IDS.venueManager],
      isVerified: true,
      isActive: true,
      createdAt: twoDaysAgo,
      updatedAt: now,
    });

  // Organization 3: Free plan org (freemium limits testing)
  await db
    .collection("organizations")
    .doc(IDS.freeOrgId)
    .set({
      id: IDS.freeOrgId,
      name: "Startup Dakar",
      slug: "startup-dakar",
      description: "Petit collectif d'organisateurs de meetups tech à Dakar — plan gratuit",
      logoURL: null,
      website: null,
      contactEmail: "contact@startup-dakar.sn",
      phone: "+221770005555",
      country: "SN",
      city: "Dakar",
      plan: "free",
      ownerId: IDS.freeOrganizer,
      memberIds: [IDS.freeOrganizer],
      isVerified: false,
      isActive: true,
      createdAt: twoDaysAgo,
      updatedAt: now,
    });

  // Organization 4: Enterprise plan org (unlimited everything)
  await db
    .collection("organizations")
    .doc(IDS.enterpriseOrgId)
    .set({
      id: IDS.enterpriseOrgId,
      name: "Groupe Sonatel Events",
      slug: "sonatel-events",
      description: "Division événementielle du Groupe Sonatel — plan enterprise",
      logoURL: null,
      website: "https://sonatel.sn",
      contactEmail: "events@sonatel.sn",
      phone: "+221770006666",
      country: "SN",
      city: "Dakar",
      plan: "enterprise",
      ownerId: IDS.enterpriseOrganizer,
      memberIds: [IDS.enterpriseOrganizer],
      isVerified: true,
      isActive: true,
      createdAt: twoDaysAgo,
      updatedAt: now,
    });

  console.log("  ✓ Teranga Events (org-001, plan: pro)");
  console.log("  ✓ Dakar Venues & Hospitality (org-002, plan: starter)");
  console.log("  ✓ Startup Dakar (org-003, plan: free)");
  console.log("  ✓ Groupe Sonatel Events (org-004, plan: enterprise)");

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. USER PROFILES
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n📋 Creating user profiles...");

  const userProfiles = [
    {
      uid: IDS.organizer,
      email: "organizer@teranga.dev",
      displayName: "Moussa Diop",
      roles: ["organizer"],
      organizationId: IDS.orgId,
      phone: "+221770001234",
      bio: "Organisateur passionné de tech events à Dakar",
    },
    {
      uid: IDS.coOrganizer,
      email: "coorganizer@teranga.dev",
      displayName: "Fatou Sall",
      roles: ["co_organizer"],
      organizationId: IDS.orgId,
      phone: "+221770001235",
      bio: "Coordinatrice événementielle",
    },
    {
      uid: IDS.participant1,
      email: "participant@teranga.dev",
      displayName: "Aminata Fall",
      roles: ["participant"],
      phone: "+221770005678",
      bio: "Développeuse full-stack passionnée par le mobile",
    },
    {
      uid: IDS.participant2,
      email: "participant2@teranga.dev",
      displayName: "Ousmane Ndiaye",
      roles: ["participant"],
      phone: "+221770009999",
      bio: "Designer UX/UI — Figma addict",
    },
    {
      uid: IDS.speakerUser,
      email: "speaker@teranga.dev",
      displayName: "Ibrahima Gueye",
      roles: ["speaker"],
      phone: "+221770007777",
      bio: "CTO & conférencier tech, expert Flutter et Firebase",
    },
    {
      uid: IDS.sponsorUser,
      email: "sponsor@teranga.dev",
      displayName: "Aissatou Ba",
      roles: ["sponsor"],
      phone: "+221770008888",
      bio: "Directrice marketing chez TechCorp Dakar",
    },
    {
      uid: IDS.superAdmin,
      email: "admin@teranga.dev",
      displayName: "Abdoulaye Sarr",
      roles: ["super_admin"],
      phone: "+221770001111",
      bio: "Administrateur plateforme Teranga",
    },
    {
      uid: IDS.venueManager,
      email: "venue@teranga.dev",
      displayName: "Khady Niang",
      roles: ["venue_manager"],
      organizationId: IDS.venueOrgId,
      phone: "+221770002222",
      bio: "Directrice de Dakar Venues & Hospitality, gestion de lieux d'événements premium",
    },
    {
      uid: IDS.freeOrganizer,
      email: "free@teranga.dev",
      displayName: "Djibril Mbaye",
      roles: ["organizer"],
      organizationId: IDS.freeOrgId,
      phone: "+221770005555",
      bio: "Fondateur de Startup Dakar — meetups tech mensuels",
    },
    {
      uid: IDS.enterpriseOrganizer,
      email: "enterprise@teranga.dev",
      displayName: "Mame Diarra Seck",
      roles: ["organizer"],
      organizationId: IDS.enterpriseOrgId,
      phone: "+221770006666",
      bio: "Head of Events, Groupe Sonatel — événements corporate pan-africains",
    },
    // ─── PR #59 role-coverage fixtures ──────────────────────────────────────
    // See the IDS comment block above for the rationale per user.
    // NOTE: `authOnlyUser` is intentionally absent from this array — we want
    // the onUserCreated trigger to create its profile with the default
    // `roles: ["participant"]`, exercising the "fresh signup" branch of the
    // fix. If you add a Firestore doc here, you'll collapse the coverage.
    {
      uid: IDS.staffUser,
      email: "staff@teranga.dev",
      displayName: "Moussa Sy",
      roles: ["staff"],
      organizationId: IDS.orgId,
      phone: "+221770003333",
      bio: "Responsable contrôle d'accès — scans QR à l'entrée des événements",
    },
    {
      uid: IDS.multiRoleUser,
      email: "multirole@teranga.dev",
      displayName: "Khadija Diop",
      roles: ["organizer", "speaker"],
      organizationId: IDS.orgId,
      phone: "+221770004444",
      bio: "Organise et intervient sur les meetups Flutter Dakar",
    },
  ];

  for (const profile of userProfiles) {
    await db
      .collection("users")
      .doc(profile.uid)
      .set({
        ...profile,
        photoURL: null,
        isActive: true,
        createdAt: twoDaysAgo,
        updatedAt: now,
      });
  }

  console.log(`  ✓ ${userProfiles.length} user profiles created`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. EVENTS
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n📅 Creating events...");

  // Event 1: Published FREE conference (main event for testing most features)
  await db
    .collection("events")
    .doc(IDS.conference)
    .set({
      id: IDS.conference,
      organizationId: IDS.orgId,
      title: "Dakar Tech Summit 2026",
      slug: "dakar-tech-summit-2026",
      description:
        "Le plus grand événement tech d'Afrique de l'Ouest. Rejoignez-nous pour deux jours de conférences, ateliers et networking avec les meilleurs talents tech du continent.",
      shortDescription: "Le rendez-vous tech incontournable de Dakar",
      coverImageURL: null,
      bannerImageURL: null,
      category: "conference",
      tags: ["tech", "startup", "dakar", "innovation"],
      format: "in_person",
      status: "published",
      location: {
        name: "Centre International de Conférences de Dakar (CICAD)",
        address: "Route de King Fahd, Almadies",
        city: "Dakar",
        country: "SN",
      },
      startDate: inOneWeek,
      endDate: inTwoWeeks,
      timezone: "Africa/Dakar",
      ticketTypes: [
        {
          id: "ticket-standard-001",
          name: "Standard",
          description: "Accès aux conférences et networking",
          price: 0,
          currency: "XOF",
          totalQuantity: 500,
          soldCount: 4,
          accessZoneIds: [],
          isVisible: true,
        },
        {
          id: "ticket-vip-001",
          name: "VIP",
          description: "Accès complet + déjeuner + places réservées",
          price: 25000,
          currency: "XOF",
          totalQuantity: 50,
          soldCount: 1,
          accessZoneIds: [],
          isVisible: true,
        },
      ],
      accessZones: [],
      maxAttendees: 550,
      registeredCount: 5,
      checkedInCount: 1,
      isPublic: true,
      isFeatured: true,
      venueId: IDS.venue1,
      venueName: "CICAD — Centre International de Conferences",
      requiresApproval: false,
      templateId: null,
      createdBy: IDS.organizer,
      updatedBy: IDS.organizer,
      createdAt: twoDaysAgo,
      updatedAt: now,
      publishedAt: yesterday,
    });

  // Event 2: Draft workshop (paid)
  await db
    .collection("events")
    .doc(IDS.workshop)
    .set({
      id: IDS.workshop,
      organizationId: IDS.orgId,
      title: "Atelier Flutter & Firebase",
      slug: "atelier-flutter-firebase",
      description:
        "Un atelier pratique de 4 heures pour apprendre à construire une application mobile avec Flutter et Firebase. Apportez votre ordinateur !",
      shortDescription: "Atelier pratique Flutter + Firebase",
      coverImageURL: null,
      bannerImageURL: null,
      category: "workshop",
      tags: ["flutter", "firebase", "mobile", "formation"],
      format: "in_person",
      status: "draft",
      location: {
        name: "Jokkolabs Dakar",
        address: "Sicap Liberté 6, Villa 7691",
        city: "Dakar",
        country: "SN",
      },
      startDate: inOneMonth,
      endDate: inOneMonth,
      timezone: "Africa/Dakar",
      ticketTypes: [
        {
          id: "ticket-standard-002",
          name: "Participant",
          description: "Place atelier",
          price: 5000,
          currency: "XOF",
          totalQuantity: 30,
          soldCount: 0,
          accessZoneIds: [],
          isVisible: true,
        },
      ],
      accessZones: [],
      maxAttendees: 30,
      registeredCount: 0,
      checkedInCount: 0,
      isPublic: true,
      isFeatured: false,
      venueId: null,
      venueName: null,
      requiresApproval: false,
      templateId: null,
      createdBy: IDS.organizer,
      updatedBy: IDS.organizer,
      createdAt: yesterday,
      updatedAt: yesterday,
      publishedAt: null,
    });

  // Event 3: Cancelled meetup
  await db
    .collection("events")
    .doc(IDS.meetup)
    .set({
      id: IDS.meetup,
      organizationId: IDS.orgId,
      title: "Meetup Développeurs Dakar #12",
      slug: "meetup-dev-dakar-12",
      description:
        "Rencontre mensuelle des développeurs de Dakar. Présentations éclair et networking.",
      shortDescription: "Meetup mensuel dev Dakar",
      coverImageURL: null,
      bannerImageURL: null,
      category: "networking",
      tags: ["meetup", "dev", "dakar"],
      format: "hybrid",
      status: "cancelled",
      location: {
        name: "Impact Hub Dakar",
        address: "Rue Carnot x Amadou Assane Ndoye",
        city: "Dakar",
        country: "SN",
        streamUrl: "https://meet.google.com/abc-defg-hij",
      },
      startDate: yesterday,
      endDate: yesterday,
      timezone: "Africa/Dakar",
      ticketTypes: [
        {
          id: "ticket-standard-003",
          name: "Entrée libre",
          price: 0,
          currency: "XOF",
          totalQuantity: null,
          soldCount: 0,
          accessZoneIds: [],
          isVisible: true,
        },
      ],
      accessZones: [],
      maxAttendees: null,
      registeredCount: 0,
      checkedInCount: 0,
      isPublic: true,
      isFeatured: false,
      venueId: null,
      venueName: null,
      requiresApproval: false,
      templateId: null,
      createdBy: IDS.organizer,
      updatedBy: IDS.organizer,
      createdAt: twoDaysAgo,
      updatedAt: yesterday,
      publishedAt: twoDaysAgo,
    });

  // Event 4: Published PAID event (for testing payment flow)
  await db
    .collection("events")
    .doc(IDS.paidEvent)
    .set({
      id: IDS.paidEvent,
      organizationId: IDS.orgId,
      title: "Masterclass IA Générative",
      slug: "masterclass-ia-generative",
      description:
        "Une journée intensive pour maîtriser les outils d'IA générative : ChatGPT, Claude, Midjourney et leurs applications business en Afrique.",
      shortDescription: "Maîtrisez l'IA générative en une journée",
      coverImageURL: null,
      bannerImageURL: null,
      category: "conference",
      tags: ["ia", "ai", "generative", "business", "dakar"],
      format: "in_person",
      status: "published",
      location: {
        name: "Radisson Blu Dakar",
        address: "Route de la Corniche, Sea Plaza",
        city: "Dakar",
        country: "SN",
      },
      startDate: inTwoWeeks,
      endDate: inTwoWeeks,
      timezone: "Africa/Dakar",
      ticketTypes: [
        {
          id: "ticket-standard-004",
          name: "Early Bird",
          description: "Tarif réduit — places limitées",
          price: 15000,
          currency: "XOF",
          totalQuantity: 50,
          soldCount: 1,
          accessZoneIds: [],
          isVisible: true,
        },
        {
          id: "ticket-vip-004",
          name: "Premium",
          description: "Accès complet + déjeuner VIP + certificat",
          price: 35000,
          currency: "XOF",
          totalQuantity: 20,
          soldCount: 1,
          accessZoneIds: [],
          isVisible: true,
        },
      ],
      accessZones: [],
      maxAttendees: 70,
      registeredCount: 2,
      checkedInCount: 0,
      isPublic: true,
      isFeatured: true,
      venueId: IDS.venue2,
      venueName: "Radisson Blu Dakar Sea Plaza",
      requiresApproval: false,
      templateId: null,
      createdBy: IDS.organizer,
      updatedBy: IDS.organizer,
      createdAt: yesterday,
      updatedAt: now,
      publishedAt: now,
    });

  console.log("  ✓ Dakar Tech Summit 2026 (published, free, venue: CICAD)");
  console.log("  ✓ Atelier Flutter & Firebase (draft)");
  console.log("  ✓ Meetup Développeurs Dakar #12 (cancelled)");
  console.log("  ✓ Masterclass IA Générative (published, paid, venue: Radisson Blu)");

  // ═══════════════════════════════════════════════════════════════════════════
  // 4b. VENUES
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n📍 Creating venues...");

  // Venue 1: Approved — major conference center (linked to event 1)
  await db
    .collection("venues")
    .doc(IDS.venue1)
    .set({
      id: IDS.venue1,
      name: "CICAD — Centre International de Conferences",
      slug: "cicad-dakar",
      description:
        "Le Centre International de Conferences Abdou Diouf est le plus grand centre de conferences d'Afrique de l'Ouest, situe sur la route de King Fahd aux Almadies.",
      address: {
        street: "Route de King Fahd, Almadies",
        city: "Dakar",
        region: "Dakar",
        country: "SN",
        coordinates: { lat: 14.7453, lng: -17.5131 },
      },
      venueType: "conference_center",
      capacity: {
        min: 100,
        max: 5000,
        configurations: [
          { name: "Theatre", capacity: 5000 },
          { name: "Classe", capacity: 2000 },
          { name: "Banquet", capacity: 1500 },
        ],
      },
      amenities: [
        "wifi",
        "parking",
        "restauration",
        "climatisation",
        "sono",
        "projecteur",
        "traduction-simultanee",
      ],
      photos: [],
      contactName: "Khady Niang",
      contactEmail: "reservation@cicad.sn",
      contactPhone: "+221338005000",
      website: "https://cicad.sn",
      hostOrganizationId: IDS.venueOrgId,
      status: "approved",
      isFeatured: true,
      rating: 4.5,
      eventCount: 1,
      createdBy: IDS.venueManager,
      updatedBy: IDS.superAdmin,
      createdAt: twoDaysAgo,
      updatedAt: now,
    });

  // Venue 2: Approved — hotel (linked to event 4)
  await db
    .collection("venues")
    .doc(IDS.venue2)
    .set({
      id: IDS.venue2,
      name: "Radisson Blu Dakar Sea Plaza",
      slug: "radisson-blu-dakar",
      description:
        "Hotel 5 etoiles avec salles de conference vue mer. Ideal pour conferences business, workshops et evenements corporate.",
      address: {
        street: "Route de la Corniche, Sea Plaza",
        city: "Dakar",
        region: "Dakar",
        country: "SN",
        coordinates: { lat: 14.7183, lng: -17.4677 },
      },
      venueType: "hotel",
      capacity: {
        min: 20,
        max: 800,
        configurations: [
          { name: "Salle Teranga", capacity: 800 },
          { name: "Salle Baobab", capacity: 200 },
          { name: "Boardroom", capacity: 30 },
        ],
      },
      amenities: [
        "wifi",
        "parking",
        "restauration",
        "climatisation",
        "sono",
        "projecteur",
        "hebergement",
        "piscine",
      ],
      photos: [],
      contactName: "Mamadou Fall",
      contactEmail: "events@radissonblu-dakar.com",
      contactPhone: "+221338891111",
      website: "https://radissonhotels.com/dakar",
      hostOrganizationId: IDS.venueOrgId,
      status: "approved",
      isFeatured: true,
      rating: 4.8,
      eventCount: 1,
      createdBy: IDS.venueManager,
      updatedBy: IDS.venueManager,
      createdAt: twoDaysAgo,
      updatedAt: now,
    });

  // Venue 3: Pending — coworking space (new, awaiting approval)
  await db
    .collection("venues")
    .doc(IDS.venue3)
    .set({
      id: IDS.venue3,
      name: "Jokkolabs Dakar",
      slug: "jokkolabs-dakar",
      description:
        "Espace de coworking et d'innovation au coeur de Dakar. Salles de reunion modulables, espace evenementiel, terrasse.",
      address: {
        street: "Sicap Liberte 6, Villa 7691",
        city: "Dakar",
        region: "Dakar",
        country: "SN",
        coordinates: { lat: 14.7167, lng: -17.45 },
      },
      venueType: "coworking",
      capacity: {
        min: 10,
        max: 120,
        configurations: [
          { name: "Open Space", capacity: 120 },
          { name: "Salle de conference", capacity: 50 },
          { name: "Workshop", capacity: 30 },
        ],
      },
      amenities: ["wifi", "climatisation", "projecteur", "cafe", "terrasse"],
      photos: [],
      contactName: "Karim Sy",
      contactEmail: "events@jokkolabs.net",
      contactPhone: "+221776543210",
      website: "https://jokkolabs.net",
      hostOrganizationId: null,
      status: "pending",
      isFeatured: false,
      rating: null,
      eventCount: 0,
      createdBy: IDS.superAdmin,
      updatedBy: IDS.superAdmin,
      createdAt: yesterday,
      updatedAt: yesterday,
    });

  console.log("  ✓ CICAD (approved, featured, 1 event)");
  console.log("  ✓ Radisson Blu Dakar (approved, featured, 1 event)");
  console.log("  ✓ Jokkolabs Dakar (pending approval)");

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. REGISTRATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n🎫 Creating registrations...");

  const epochBase36 = Date.now().toString(36);

  // Reg 1: Participant 1 → Conference (confirmed, checked in)
  await db
    .collection("registrations")
    .doc(IDS.reg1)
    .set({
      id: IDS.reg1,
      eventId: IDS.conference,
      userId: IDS.participant1,
      ticketTypeId: "ticket-standard-001",
      status: "confirmed",
      qrCodeValue: `${IDS.reg1}:${IDS.conference}:${IDS.participant1}:${epochBase36}:demo-hmac-sig-001`,
      checkedInAt: oneHourAgo,
      checkedInBy: IDS.organizer,
      accessZoneId: null,
      notes: null,
      createdAt: yesterday,
      updatedAt: oneHourAgo,
    });

  // Reg 2: Participant 2 → Conference (confirmed, not checked in)
  await db
    .collection("registrations")
    .doc(IDS.reg2)
    .set({
      id: IDS.reg2,
      eventId: IDS.conference,
      userId: IDS.participant2,
      ticketTypeId: "ticket-standard-001",
      status: "confirmed",
      qrCodeValue: `${IDS.reg2}:${IDS.conference}:${IDS.participant2}:${epochBase36}:demo-hmac-sig-002`,
      checkedInAt: null,
      checkedInBy: null,
      accessZoneId: null,
      notes: null,
      createdAt: yesterday,
      updatedAt: yesterday,
    });

  // Reg 3: Speaker → Conference (confirmed)
  await db
    .collection("registrations")
    .doc(IDS.reg3)
    .set({
      id: IDS.reg3,
      eventId: IDS.conference,
      userId: IDS.speakerUser,
      ticketTypeId: "ticket-standard-001",
      status: "confirmed",
      qrCodeValue: `${IDS.reg3}:${IDS.conference}:${IDS.speakerUser}:${epochBase36}:demo-hmac-sig-003`,
      checkedInAt: null,
      checkedInBy: null,
      accessZoneId: null,
      notes: "Intervenant",
      createdAt: yesterday,
      updatedAt: yesterday,
    });

  // Reg 4: Sponsor user → Conference (confirmed)
  await db
    .collection("registrations")
    .doc(IDS.reg4)
    .set({
      id: IDS.reg4,
      eventId: IDS.conference,
      userId: IDS.sponsorUser,
      ticketTypeId: "ticket-vip-001",
      status: "confirmed",
      qrCodeValue: `${IDS.reg4}:${IDS.conference}:${IDS.sponsorUser}:${epochBase36}:demo-hmac-sig-004`,
      checkedInAt: null,
      checkedInBy: null,
      accessZoneId: null,
      notes: "Sponsor TechCorp",
      createdAt: yesterday,
      updatedAt: yesterday,
    });

  // Reg 5: Participant 1 → Paid event (pending_payment)
  await db.collection("registrations").doc(IDS.reg5).set({
    id: IDS.reg5,
    eventId: IDS.paidEvent,
    userId: IDS.participant1,
    ticketTypeId: "ticket-standard-004",
    status: "pending_payment",
    qrCodeValue: null,
    checkedInAt: null,
    checkedInBy: null,
    accessZoneId: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
  });

  // Reg 6: Participant 2 → Paid event (confirmed after payment)
  await db
    .collection("registrations")
    .doc(IDS.reg6)
    .set({
      id: IDS.reg6,
      eventId: IDS.paidEvent,
      userId: IDS.participant2,
      ticketTypeId: "ticket-vip-004",
      status: "confirmed",
      qrCodeValue: `${IDS.reg6}:${IDS.paidEvent}:${IDS.participant2}:${epochBase36}:demo-hmac-sig-006`,
      checkedInAt: null,
      checkedInBy: null,
      accessZoneId: null,
      notes: null,
      createdAt: yesterday,
      updatedAt: yesterday,
    });

  console.log("  ✓ 4 registrations on Dakar Tech Summit (1 checked-in)");
  console.log("  ✓ 2 registrations on Masterclass IA (1 pending_payment, 1 confirmed)");

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. BADGES
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n🏷️  Creating badges...");

  await db
    .collection("badges")
    .doc("badge-001")
    .set({
      id: "badge-001",
      registrationId: IDS.reg1,
      eventId: IDS.conference,
      userId: IDS.participant1,
      templateId: null,
      pdfURL: null,
      qrCodeValue: `${IDS.reg1}:${IDS.conference}:${IDS.participant1}:${epochBase36}:demo-hmac-sig-001`,
      status: "generated",
      error: null,
      generatedAt: yesterday,
      createdAt: yesterday,
      updatedAt: yesterday,
    });

  await db
    .collection("badges")
    .doc("badge-002")
    .set({
      id: "badge-002",
      registrationId: IDS.reg2,
      eventId: IDS.conference,
      userId: IDS.participant2,
      templateId: null,
      pdfURL: null,
      qrCodeValue: `${IDS.reg2}:${IDS.conference}:${IDS.participant2}:${epochBase36}:demo-hmac-sig-002`,
      status: "generated",
      error: null,
      generatedAt: yesterday,
      createdAt: yesterday,
      updatedAt: yesterday,
    });

  console.log("  ✓ 2 badges for conference registrations");

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. SESSIONS (Wave 5)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n📋 Creating sessions...");

  const sessions = [
    {
      id: IDS.session1,
      eventId: IDS.conference,
      title: "Keynote : L'avenir de la tech en Afrique de l'Ouest",
      description:
        "Panorama des opportunités tech au Sénégal et dans la sous-région. Comment les startups africaines transforment le continent.",
      speakerIds: [IDS.speaker1],
      location: "Salle principale (CICAD)",
      startTime: inOneWeek,
      endTime: inOneWeekPlus1h,
      tags: ["keynote", "afrique", "tech"],
      streamUrl: null,
      isBookmarkable: true,
    },
    {
      id: IDS.session2,
      eventId: IDS.conference,
      title: "Atelier : Construire une API avec Fastify et TypeScript",
      description:
        "Hands-on : créer une API REST performante de zéro avec Fastify, Zod et TypeScript.",
      speakerIds: [IDS.speaker2],
      location: "Salle B",
      startTime: inOneWeekPlus1h,
      endTime: inOneWeekPlus2h,
      tags: ["atelier", "fastify", "typescript", "api"],
      streamUrl: null,
      isBookmarkable: true,
    },
    {
      id: IDS.session3,
      eventId: IDS.conference,
      title: "Table ronde : Mobile Money et inclusion financière",
      description:
        "Débat avec les acteurs de Wave, Orange Money et les fintechs locales sur l'accès aux services financiers.",
      speakerIds: [IDS.speaker1, IDS.speaker2],
      location: "Salle principale (CICAD)",
      startTime: inOneWeekPlus2h,
      endTime: inOneWeekPlus3h,
      tags: ["fintech", "mobile-money", "inclusion"],
      streamUrl: "https://meet.google.com/dts-panel-2026",
      isBookmarkable: true,
    },
    {
      id: IDS.session4,
      eventId: IDS.conference,
      title: "Networking & Cocktail de clôture",
      description:
        "Rencontrez les participants, échangez vos cartes et profitez du cocktail offert par nos sponsors.",
      speakerIds: [],
      location: "Terrasse CICAD",
      startTime: inOneWeekPlus3h,
      endTime: inOneWeekPlus4h,
      tags: ["networking"],
      streamUrl: null,
      isBookmarkable: false,
    },
  ];

  for (const s of sessions) {
    await db
      .collection("sessions")
      .doc(s.id)
      .set({
        ...s,
        createdAt: yesterday,
        updatedAt: yesterday,
      });
  }

  console.log(`  ✓ ${sessions.length} sessions for Dakar Tech Summit`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. SPEAKERS (Wave 8)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n🎤 Creating speakers...");

  await db
    .collection("speakers")
    .doc(IDS.speaker1)
    .set({
      id: IDS.speaker1,
      userId: IDS.speakerUser,
      eventId: IDS.conference,
      organizationId: IDS.orgId,
      name: "Ibrahima Gueye",
      title: "CTO @ Teranga Digital",
      company: "Teranga Digital",
      bio: "15 ans d'expérience en développement. Expert Flutter, Firebase et architectures cloud. Conférencier régulier à DakarDev et AfricaTech.",
      photoURL: null,
      socialLinks: {
        twitter: "https://twitter.com/ibragueye_dev",
        linkedin: "https://linkedin.com/in/ibrahima-gueye",
        website: "https://ibrahima.dev",
      },
      topics: ["flutter", "firebase", "cloud", "architecture"],
      sessionIds: [IDS.session1, IDS.session3],
      isConfirmed: true,
      createdAt: yesterday,
      updatedAt: yesterday,
    });

  await db
    .collection("speakers")
    .doc(IDS.speaker2)
    .set({
      id: IDS.speaker2,
      userId: null, // external speaker, no platform account
      eventId: IDS.conference,
      organizationId: IDS.orgId,
      name: "Marie-Claire Diouf",
      title: "Lead Developer @ Wave",
      company: "Wave",
      bio: "Ingénieure logiciel spécialisée en systèmes de paiement et APIs financières. Passionnée par l'inclusion numérique.",
      photoURL: null,
      socialLinks: {
        twitter: null,
        linkedin: "https://linkedin.com/in/mc-diouf",
        website: null,
      },
      topics: ["fintech", "api", "typescript", "payments"],
      sessionIds: [IDS.session2, IDS.session3],
      isConfirmed: true,
      createdAt: yesterday,
      updatedAt: yesterday,
    });

  console.log("  ✓ Ibrahima Gueye (platform user, 2 sessions)");
  console.log("  ✓ Marie-Claire Diouf (external speaker, 2 sessions)");

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. SPONSORS (Wave 8)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n🏢 Creating sponsors...");

  await db.collection("sponsors").doc(IDS.sponsor1).set({
    id: IDS.sponsor1,
    userId: IDS.sponsorUser,
    eventId: IDS.conference,
    organizationId: IDS.orgId,
    companyName: "TechCorp Dakar",
    logoURL: null,
    description:
      "Leader des solutions cloud en Afrique de l'Ouest. Nous accompagnons les entreprises dans leur transformation numérique.",
    website: "https://techcorp.sn",
    tier: "gold",
    boothTitle: "Stand TechCorp — Demos Cloud",
    boothDescription: "Venez découvrir nos solutions cloud et repartez avec des goodies !",
    boothBannerURL: null,
    ctaLabel: "Découvrir nos offres",
    ctaUrl: "https://techcorp.sn/offres",
    contactName: "Aissatou Ba",
    contactEmail: "aissatou@techcorp.sn",
    contactPhone: "+221770008888",
    isActive: true,
    createdAt: yesterday,
    updatedAt: yesterday,
  });

  await db.collection("sponsors").doc(IDS.sponsor2).set({
    id: IDS.sponsor2,
    userId: null,
    eventId: IDS.conference,
    organizationId: IDS.orgId,
    companyName: "Orange Digital Center",
    logoURL: null,
    description: "Programme d'accompagnement des startups et développeurs par Orange Sénégal.",
    website: "https://orangedigitalcenter.sn",
    tier: "silver",
    boothTitle: "Orange Digital Center — Espace Formation",
    boothDescription: "Découvrez nos programmes de formation gratuits et nos API.",
    boothBannerURL: null,
    ctaLabel: "Rejoindre le programme",
    ctaUrl: "https://orangedigitalcenter.sn/postuler",
    contactName: "Mamadou Diallo",
    contactEmail: "mdiallo@orange.sn",
    contactPhone: "+221770006666",
    isActive: true,
    createdAt: yesterday,
    updatedAt: yesterday,
  });

  console.log("  ✓ TechCorp Dakar (gold tier, with platform user)");
  console.log("  ✓ Orange Digital Center (silver tier, external)");

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. SPONSOR LEADS (Wave 8)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n📇 Creating sponsor leads...");

  await db
    .collection("sponsorLeads")
    .doc("lead-001")
    .set({
      id: "lead-001",
      sponsorId: IDS.sponsor1,
      eventId: IDS.conference,
      participantId: IDS.participant1,
      participantName: "Aminata Fall",
      participantEmail: "participant@teranga.dev",
      participantPhone: "+221770005678",
      notes: "Intéressée par notre offre startup. A demandé un devis pour l'hébergement cloud.",
      tags: ["startup", "cloud", "prospect-chaud"],
      scannedAt: oneHourAgo,
      scannedBy: IDS.sponsorUser,
    });

  console.log("  ✓ 1 lead scanned by TechCorp (Aminata Fall)");

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. PAYMENTS (Wave 6)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n💰 Creating payments...");

  // Payment 1: Succeeded (participant2 → paid event, VIP ticket)
  await db
    .collection("payments")
    .doc(IDS.payment1)
    .set({
      id: IDS.payment1,
      registrationId: IDS.reg6,
      eventId: IDS.paidEvent,
      organizationId: IDS.orgId,
      userId: IDS.participant2,
      amount: 35000,
      currency: "XOF",
      method: "mock",
      providerTransactionId: "mock-tx-001",
      status: "succeeded",
      redirectUrl: null,
      callbackUrl: null,
      returnUrl: "http://localhost:3002/events/masterclass-ia-generative",
      providerMetadata: { mockProvider: true },
      failureReason: null,
      refundedAmount: 0,
      initiatedAt: yesterday,
      completedAt: yesterday,
      createdAt: yesterday,
      updatedAt: yesterday,
    });

  // Payment 2: Pending (participant1 → paid event, Early Bird)
  await db.collection("payments").doc(IDS.payment2).set({
    id: IDS.payment2,
    registrationId: IDS.reg5,
    eventId: IDS.paidEvent,
    organizationId: IDS.orgId,
    userId: IDS.participant1,
    amount: 15000,
    currency: "XOF",
    method: "mock",
    providerTransactionId: "mock-tx-002",
    status: "pending",
    redirectUrl: "http://localhost:3000/v1/payments/mock-checkout/mock-tx-002",
    callbackUrl: "http://localhost:3000/v1/payments/webhook",
    returnUrl: "http://localhost:3002/events/masterclass-ia-generative",
    providerMetadata: null,
    failureReason: null,
    refundedAmount: 0,
    initiatedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  console.log("  ✓ Payment 35 000 XOF succeeded (Ousmane → Masterclass VIP)");
  console.log("  ✓ Payment 15 000 XOF pending (Aminata → Masterclass Early Bird)");

  // ═══════════════════════════════════════════════════════════════════════════
  // 12. RECEIPT (Wave 6)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n🧾 Creating receipts...");

  await db.collection("receipts").doc("receipt-001").set({
    id: "receipt-001",
    receiptNumber: "REC-2026-000001",
    paymentId: IDS.payment1,
    registrationId: IDS.reg6,
    eventId: IDS.paidEvent,
    organizationId: IDS.orgId,
    userId: IDS.participant2,
    amount: 35000,
    currency: "XOF",
    method: "mock",
    eventTitle: "Masterclass IA Générative",
    ticketTypeName: "Premium",
    participantName: "Ousmane Ndiaye",
    participantEmail: "participant2@teranga.dev",
    organizationName: "Teranga Events",
    issuedAt: yesterday,
    createdAt: yesterday,
  });

  // Receipt counter document
  await db.collection("counters").doc("receipts").set({ lastNumber: 1 });

  console.log("  ✓ Receipt REC-2026-000001 for Ousmane Ndiaye");

  // ═══════════════════════════════════════════════════════════════════════════
  // 13. FEED POSTS & COMMENTS (Wave 5)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n📝 Creating feed posts...");

  await db
    .collection("feedPosts")
    .doc(IDS.post1)
    .set({
      id: IDS.post1,
      eventId: IDS.conference,
      authorId: IDS.organizer,
      authorName: "Moussa Diop",
      authorPhotoURL: null,
      authorRole: "organizer",
      content:
        "🎉 Bienvenue au Dakar Tech Summit 2026 ! Le programme est en ligne. N'oubliez pas de réserver vos places pour les ateliers. #DTS2026",
      mediaURLs: [],
      likeCount: 3,
      commentCount: 1,
      likedByIds: [IDS.participant1, IDS.participant2, IDS.speakerUser],
      isPinned: true,
      isAnnouncement: true,
      createdAt: yesterday,
      updatedAt: yesterday,
      deletedAt: null,
    });

  await db
    .collection("feedPosts")
    .doc(IDS.post2)
    .set({
      id: IDS.post2,
      eventId: IDS.conference,
      authorId: IDS.speakerUser,
      authorName: "Ibrahima Gueye",
      authorPhotoURL: null,
      authorRole: "speaker",
      content:
        "Hâte de vous retrouver pour la keynote ! Je prépare une démo live de Flutter + Firebase qui va vous surprendre 🚀",
      mediaURLs: [],
      likeCount: 5,
      commentCount: 1,
      likedByIds: [
        IDS.participant1,
        IDS.participant2,
        IDS.organizer,
        IDS.coOrganizer,
        IDS.sponsorUser,
      ],
      isPinned: false,
      isAnnouncement: false,
      createdAt: yesterday,
      updatedAt: yesterday,
      deletedAt: null,
    });

  await db
    .collection("feedPosts")
    .doc(IDS.post3)
    .set({
      id: IDS.post3,
      eventId: IDS.conference,
      authorId: IDS.participant1,
      authorName: "Aminata Fall",
      authorPhotoURL: null,
      authorRole: "participant",
      content: "Quelqu'un pour partager un taxi depuis Plateau jusqu'au CICAD le jour J ? 🚕",
      mediaURLs: [],
      likeCount: 1,
      commentCount: 0,
      likedByIds: [IDS.participant2],
      isPinned: false,
      isAnnouncement: false,
      createdAt: oneHourAgo,
      updatedAt: oneHourAgo,
      deletedAt: null,
    });

  // Comments
  await db.collection("feedComments").doc(IDS.comment1).set({
    id: IDS.comment1,
    postId: IDS.post1,
    authorId: IDS.participant1,
    authorName: "Aminata Fall",
    content: "Trop hâte ! Le programme est super cette année 🔥",
    createdAt: yesterday,
    deletedAt: null,
  });

  await db.collection("feedComments").doc(IDS.comment2).set({
    id: IDS.comment2,
    postId: IDS.post2,
    authorId: IDS.participant2,
    authorName: "Ousmane Ndiaye",
    content: "Flutter + Firebase = combo gagnant ! Vivement la démo",
    createdAt: yesterday,
    deletedAt: null,
  });

  console.log("  ✓ 3 feed posts (1 pinned announcement, 1 speaker, 1 participant)");
  console.log("  ✓ 2 comments");

  // ═══════════════════════════════════════════════════════════════════════════
  // 14. CONVERSATIONS & MESSAGES (Wave 5)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n💬 Creating conversations & messages...");

  // Conversation 1: participant1 ↔ speaker
  await db
    .collection("conversations")
    .doc(IDS.conv1)
    .set({
      id: IDS.conv1,
      participantIds: [IDS.participant1, IDS.speakerUser],
      eventId: IDS.conference,
      lastMessage: "Avec plaisir ! Passez au stand après la keynote",
      lastMessageAt: oneHourAgo,
      unreadCounts: { [IDS.participant1]: 1, [IDS.speakerUser]: 0 },
      createdAt: yesterday,
      updatedAt: oneHourAgo,
    });

  await db.collection("messages").doc("msg-001").set({
    id: "msg-001",
    conversationId: IDS.conv1,
    senderId: IDS.participant1,
    content:
      "Bonjour Ibrahima ! J'ai adoré votre talk au meetup #11. Est-ce qu'on pourrait discuter de Firebase offline ?",
    type: "text",
    mediaURL: null,
    isRead: true,
    readAt: yesterday,
    createdAt: yesterday,
    updatedAt: yesterday,
    deletedAt: null,
  });

  await db.collection("messages").doc("msg-002").set({
    id: "msg-002",
    conversationId: IDS.conv1,
    senderId: IDS.speakerUser,
    content: "Avec plaisir ! Passez au stand après la keynote",
    type: "text",
    mediaURL: null,
    isRead: false,
    readAt: null,
    createdAt: oneHourAgo,
    updatedAt: oneHourAgo,
    deletedAt: null,
  });

  // Conversation 2: participant1 ↔ participant2
  await db
    .collection("conversations")
    .doc(IDS.conv2)
    .set({
      id: IDS.conv2,
      participantIds: [IDS.participant1, IDS.participant2],
      eventId: IDS.conference,
      lastMessage: "On se retrouve à l'entrée du CICAD ?",
      lastMessageAt: oneHourAgo,
      unreadCounts: { [IDS.participant1]: 0, [IDS.participant2]: 1 },
      createdAt: oneHourAgo,
      updatedAt: oneHourAgo,
    });

  await db.collection("messages").doc("msg-003").set({
    id: "msg-003",
    conversationId: IDS.conv2,
    senderId: IDS.participant1,
    content: "On se retrouve à l'entrée du CICAD ?",
    type: "text",
    mediaURL: null,
    isRead: false,
    readAt: null,
    createdAt: oneHourAgo,
    updatedAt: oneHourAgo,
    deletedAt: null,
  });

  console.log("  ✓ 2 conversations, 3 messages");

  // ═══════════════════════════════════════════════════════════════════════════
  // 15. NOTIFICATIONS (Wave 5/7)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n🔔 Creating notifications...");

  const notifications = [
    {
      id: "notif-001",
      userId: IDS.participant1,
      type: "registration_confirmed",
      title: "Inscription confirmée",
      body: "Votre inscription au Dakar Tech Summit 2026 est confirmée. Votre badge est prêt !",
      data: { eventId: IDS.conference, registrationId: IDS.reg1 },
      isRead: true,
      readAt: yesterday,
      createdAt: yesterday,
    },
    {
      id: "notif-002",
      userId: IDS.participant2,
      type: "registration_confirmed",
      title: "Inscription confirmée",
      body: "Votre inscription au Dakar Tech Summit 2026 est confirmée.",
      data: { eventId: IDS.conference, registrationId: IDS.reg2 },
      isRead: false,
      readAt: null,
      createdAt: yesterday,
    },
    {
      id: "notif-003",
      userId: IDS.participant1,
      type: "check_in_success",
      title: "Check-in réussi",
      body: "Vous êtes enregistré(e) au Dakar Tech Summit. Bon événement !",
      data: { eventId: IDS.conference },
      isRead: true,
      readAt: oneHourAgo,
      createdAt: oneHourAgo,
    },
    {
      id: "notif-004",
      userId: IDS.participant1,
      type: "new_message",
      title: "Nouveau message",
      body: "Ibrahima Gueye vous a envoyé un message",
      data: { conversationId: IDS.conv1 },
      isRead: false,
      readAt: null,
      createdAt: oneHourAgo,
    },
    {
      id: "notif-005",
      userId: IDS.participant2,
      type: "new_announcement",
      title: "Nouvelle annonce",
      body: "Moussa Diop a publié une annonce pour Dakar Tech Summit 2026",
      data: { eventId: IDS.conference, postId: IDS.post1 },
      isRead: false,
      readAt: null,
      createdAt: yesterday,
    },
  ];

  for (const n of notifications) {
    await db
      .collection("notifications")
      .doc(n.id)
      .set({
        ...n,
        imageURL: null,
      });
  }

  console.log(`  ✓ ${notifications.length} notifications (2 read, 3 unread)`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 16. NOTIFICATION PREFERENCES (Wave 7)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n⚙️  Creating notification preferences...");

  const prefUsers = [IDS.participant1, IDS.participant2, IDS.speakerUser];
  for (const uid of prefUsers) {
    await db.collection("notificationPreferences").doc(uid).set({
      id: uid,
      userId: uid,
      email: true,
      sms: true,
      push: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
      updatedAt: now,
    });
  }

  console.log(`  ✓ ${prefUsers.length} notification preference records`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 17. BROADCAST (Wave 7)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n📢 Creating broadcasts...");

  await db
    .collection("broadcasts")
    .doc(IDS.broadcast1)
    .set({
      id: IDS.broadcast1,
      eventId: IDS.conference,
      organizationId: IDS.orgId,
      title: "Rappel : Dakar Tech Summit dans 1 semaine",
      body: "Chers participants, le Dakar Tech Summit 2026 démarre dans 7 jours au CICAD. Consultez le programme et préparez vos questions ! À bientôt 🎉",
      channels: ["email", "push"],
      recipientFilter: "all",
      recipientCount: 4,
      sentCount: 4,
      failedCount: 0,
      status: "sent",
      createdBy: IDS.organizer,
      createdAt: yesterday,
      sentAt: yesterday,
    });

  console.log("  ✓ 1 broadcast sent (email + push to all registrants)");

  // ═══════════════════════════════════════════════════════════════════════════
  // 18. CHECK-IN FEED (Wave 2)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n📍 Creating check-in feed entries...");

  await db.collection("checkinFeed").doc("checkin-001").set({
    id: "checkin-001",
    eventId: IDS.conference,
    registrationId: IDS.reg1,
    userId: IDS.participant1,
    userName: "Aminata Fall",
    ticketType: "Standard",
    checkedInBy: IDS.organizer,
    checkedInAt: oneHourAgo,
    method: "qr_scan",
  });

  console.log("  ✓ 1 check-in feed entry (Aminata Fall, QR scan)");

  // ═══════════════════════════════════════════════════════════════════════════
  // 19. AUDIT LOGS (sample)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n📜 Creating sample audit logs...");

  const auditEvents = [
    {
      action: "event.created",
      resourceType: "event",
      resourceId: IDS.conference,
      actorId: IDS.organizer,
      eventId: IDS.conference,
      details: { title: "Dakar Tech Summit 2026" },
    },
    {
      action: "event.published",
      resourceType: "event",
      resourceId: IDS.conference,
      actorId: IDS.organizer,
      eventId: IDS.conference,
      details: {},
    },
    {
      action: "registration.created",
      resourceType: "registration",
      resourceId: IDS.reg1,
      actorId: IDS.participant1,
      eventId: IDS.conference,
      details: { ticketType: "Standard" },
    },
    {
      action: "registration.checked_in",
      resourceType: "registration",
      resourceId: IDS.reg1,
      actorId: IDS.organizer,
      eventId: IDS.conference,
      details: { method: "qr_scan" },
    },
    {
      action: "sponsor.added",
      resourceType: "sponsor",
      resourceId: IDS.sponsor1,
      actorId: IDS.organizer,
      eventId: IDS.conference,
      details: { companyName: "TechCorp Dakar" },
    },
    {
      action: "venue.created",
      resourceType: "venue",
      resourceId: IDS.venue1,
      actorId: IDS.venueManager,
      eventId: null,
      details: { name: "CICAD" },
    },
    {
      action: "venue.approved",
      resourceType: "venue",
      resourceId: IDS.venue1,
      actorId: IDS.superAdmin,
      eventId: null,
      details: { name: "CICAD" },
    },
    {
      action: "venue.created",
      resourceType: "venue",
      resourceId: IDS.venue2,
      actorId: IDS.venueManager,
      eventId: null,
      details: { name: "Radisson Blu" },
    },
    {
      action: "organization.verified",
      resourceType: "organization",
      resourceId: IDS.venueOrgId,
      actorId: IDS.superAdmin,
      eventId: null,
      details: { orgName: "Dakar Venues & Hospitality" },
    },
    {
      action: "user.role_changed",
      resourceType: "user",
      resourceId: IDS.venueManager,
      actorId: IDS.superAdmin,
      eventId: null,
      details: { newRoles: ["venue_manager"] },
    },
    {
      action: "subscription.upgraded",
      resourceType: "organization",
      resourceId: IDS.orgId,
      actorId: IDS.organizer,
      eventId: null,
      details: { from: "free", to: "pro" },
    },
    {
      action: "subscription.upgraded",
      resourceType: "organization",
      resourceId: IDS.enterpriseOrgId,
      actorId: IDS.enterpriseOrganizer,
      eventId: null,
      details: { from: "free", to: "enterprise" },
    },
  ];

  for (let i = 0; i < auditEvents.length; i++) {
    await db
      .collection("auditLogs")
      .doc(`audit-${String(i + 1).padStart(3, "0")}`)
      .set({
        id: `audit-${String(i + 1).padStart(3, "0")}`,
        ...auditEvents[i],
        organizationId: IDS.orgId,
        requestId: `seed-req-${i + 1}`,
        timestamp: yesterday,
      });
  }

  console.log(`  ✓ ${auditEvents.length} audit log entries (including venue & admin actions)`);

  // NOTE: plan catalog is seeded up-front (always-runs block near the top of
  // seed()) so this function no longer needs a dedicated plan-catalog step.

  // ═══════════════════════════════════════════════════════════════════════════
  // 20. SUBSCRIPTIONS (Freemium Model)
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n💳 Creating subscriptions...");

  const periodStart = twoDaysAgo;
  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // Subscription for org-002 (starter plan)
  await db.collection("subscriptions").doc("sub-001").set({
    id: "sub-001",
    organizationId: IDS.venueOrgId,
    plan: "starter",
    status: "active",
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    cancelledAt: null,
    cancelReason: null,
    paymentMethod: null,
    priceXof: 9900,
    createdAt: twoDaysAgo,
    updatedAt: now,
  });

  // Subscription for org-001 (pro plan)
  await db.collection("subscriptions").doc("sub-002").set({
    id: "sub-002",
    organizationId: IDS.orgId,
    plan: "pro",
    status: "active",
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    cancelledAt: null,
    cancelReason: null,
    paymentMethod: null,
    priceXof: 29900,
    createdAt: twoDaysAgo,
    updatedAt: now,
  });

  // Subscription for org-004 (enterprise plan)
  await db.collection("subscriptions").doc("sub-003").set({
    id: "sub-003",
    organizationId: IDS.enterpriseOrgId,
    plan: "enterprise",
    status: "active",
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    cancelledAt: null,
    cancelReason: null,
    paymentMethod: null,
    priceXof: 0,
    createdAt: twoDaysAgo,
    updatedAt: now,
  });

  // No subscription for org-003 (free plan — no subscription needed)

  console.log("  ✓ sub-001: Dakar Venues (starter, 9 900 XOF/mois)");
  console.log("  ✓ sub-002: Teranga Events (pro, 29 900 XOF/mois)");
  console.log("  ✓ sub-003: Sonatel Events (enterprise, custom)");
  console.log("  ✓ Startup Dakar — no subscription (free plan)");

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
