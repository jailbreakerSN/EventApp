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
  Dates,
} from "./seed/config";

configureEmulatorHosts();
assertSafeTarget();

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { IDS } from "./seed/ids";
import { seedOrganizations } from "./seed/01-organizations";
import { seedUsers } from "./seed/02-users";
import { seedVenues } from "./seed/03-venues";
import { seedEvents } from "./seed/04-events";

const app = initializeApp({ projectId: PROJECT_ID });
const auth = getAuth(app);
const db = getFirestore(app);

// ─── Time helpers ──────────────────────────────────────────────────────────
// Aliases preserved so the inline sections 5-20 below keep reading naturally
// (`createdAt: yesterday`, `startDate: inOneWeek`, ...). The actual offsets
// live in scripts/seed/config.ts → Dates. Sections 1-4 (users / orgs /
// venues / events) have moved to dedicated modules under scripts/seed/.

const now = Dates.now;
const oneHourAgo = Dates.oneHourAgo;
const yesterday = Dates.yesterday;
const twoDaysAgo = Dates.twoDaysAgo;
const inOneWeek = Dates.inOneWeek;
const inOneWeekPlus1h = Dates.inOneWeekPlus1h;
const inOneWeekPlus2h = Dates.inOneWeekPlus2h;
const inOneWeekPlus3h = Dates.inOneWeekPlus3h;
const inOneWeekPlus4h = Dates.inOneWeekPlus4h;
const inTwoWeeks = Dates.inTwoWeeks;
const inOneMonth = Dates.inOneMonth;

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
  // 5. REGISTRATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n🎫 Creating registrations...");

  const epochBase36 = Date.now().toString(36);

  // Denormalized event metadata copied onto each registration. The API
  // populates these four fields automatically on real writes (see
  // apps/api/src/services/registration.service.ts); the seed has to mirror
  // that contract or the calendar + my-events surfaces render empty dates.
  const eventDenorm = {
    [IDS.conference]: {
      eventTitle: "Dakar Tech Summit 2026",
      eventSlug: "dakar-tech-summit-2026",
      eventStartDate: inOneWeek,
      eventEndDate: inTwoWeeks,
    },
    [IDS.paidEvent]: {
      eventTitle: "Masterclass IA Générative",
      eventSlug: "masterclass-ia-generative",
      eventStartDate: inTwoWeeks,
      eventEndDate: inTwoWeeks,
    },
  } as const;

  // Display names for the same two events' ticket types, surfaced in
  // registration cards / ticket passes.
  const ticketNames: Record<string, string> = {
    "ticket-standard-001": "Standard",
    "ticket-vip-001": "VIP",
    "ticket-standard-004": "Early Bird",
    "ticket-vip-004": "Premium",
  };

  // Reg 1: Participant 1 → Conference (confirmed, checked in)
  await db
    .collection("registrations")
    .doc(IDS.reg1)
    .set({
      id: IDS.reg1,
      eventId: IDS.conference,
      userId: IDS.participant1,
      ticketTypeId: "ticket-standard-001",
      ticketTypeName: ticketNames["ticket-standard-001"],
      participantName: "Aminata Fall",
      participantEmail: "participant@teranga.dev",
      ...eventDenorm[IDS.conference],
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
      ticketTypeName: ticketNames["ticket-standard-001"],
      participantName: "Ousmane Ndiaye",
      participantEmail: "participant2@teranga.dev",
      ...eventDenorm[IDS.conference],
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
      ticketTypeName: ticketNames["ticket-standard-001"],
      participantName: "Ibrahima Gueye",
      participantEmail: "speaker@teranga.dev",
      ...eventDenorm[IDS.conference],
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
      ticketTypeName: ticketNames["ticket-vip-001"],
      participantName: "Aissatou Ba",
      participantEmail: "sponsor@teranga.dev",
      ...eventDenorm[IDS.conference],
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
  // qrCodeValue is a placeholder sentinel because RegistrationSchema requires
  // a non-nullable string; real pending_payment registrations get the HMAC-
  // signed payload on confirmation.
  await db.collection("registrations").doc(IDS.reg5).set({
    id: IDS.reg5,
    eventId: IDS.paidEvent,
    userId: IDS.participant1,
    ticketTypeId: "ticket-standard-004",
    ticketTypeName: ticketNames["ticket-standard-004"],
    participantName: "Aminata Fall",
    participantEmail: "participant@teranga.dev",
    ...eventDenorm[IDS.paidEvent],
    status: "pending_payment",
    qrCodeValue: `pending:${IDS.reg5}`,
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
      ticketTypeName: ticketNames["ticket-vip-004"],
      participantName: "Ousmane Ndiaye",
      participantEmail: "participant2@teranga.dev",
      ...eventDenorm[IDS.paidEvent],
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
