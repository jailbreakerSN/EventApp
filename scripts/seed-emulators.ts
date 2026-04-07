/**
 * Seed Firebase Emulators with comprehensive test data for local development.
 *
 * Prerequisites:
 *   1. Firebase emulators running: `firebase emulators:start`
 *   2. Run: `npx tsx scripts/seed-emulators.ts`
 *
 * Creates:
 *   - 6 users (organizer, co-organizer, 2 participants, speaker, sponsor)
 *   - 1 organization
 *   - 4 events (published paid, published free, draft, cancelled)
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
 *   - Notification preferences
 *   - Check-in feed entries
 */

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";

import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const app = initializeApp({ projectId: "teranga-app-990a8" });
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
  // Users
  organizer: "organizer-uid-001",
  coOrganizer: "coorg-uid-001",
  participant1: "participant-uid-001",
  participant2: "participant-uid-002",
  speakerUser: "speaker-uid-001",
  sponsorUser: "sponsor-uid-001",
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
  console.log("🌱 Seeding Firebase emulators (Waves 1-8 data)...\n");

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. USERS
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("👤 Creating users...");

  const organizer = await ensureUser(
    IDS.organizer,
    { email: "organizer@teranga.dev", password: "password123", displayName: "Moussa Diop" },
    { roles: ["organizer"], organizationId: IDS.orgId },
  );

  const coOrganizer = await ensureUser(
    IDS.coOrganizer,
    { email: "coorganizer@teranga.dev", password: "password123", displayName: "Fatou Sall" },
    { roles: ["co_organizer"], organizationId: IDS.orgId },
  );

  const participant1 = await ensureUser(
    IDS.participant1,
    { email: "participant@teranga.dev", password: "password123", displayName: "Aminata Fall" },
    { roles: ["participant"] },
  );

  const participant2 = await ensureUser(
    IDS.participant2,
    { email: "participant2@teranga.dev", password: "password123", displayName: "Ousmane Ndiaye" },
    { roles: ["participant"] },
  );

  const speakerUser = await ensureUser(
    IDS.speakerUser,
    { email: "speaker@teranga.dev", password: "password123", displayName: "Ibrahima Gueye" },
    { roles: ["speaker"] },
  );

  const sponsorUser = await ensureUser(
    IDS.sponsorUser,
    { email: "sponsor@teranga.dev", password: "password123", displayName: "Aissatou Ba" },
    { roles: ["sponsor"] },
  );

  console.log("  ✓ organizer@teranga.dev / password123 (organizer)");
  console.log("  ✓ coorganizer@teranga.dev / password123 (co_organizer)");
  console.log("  ✓ participant@teranga.dev / password123 (participant)");
  console.log("  ✓ participant2@teranga.dev / password123 (participant)");
  console.log("  ✓ speaker@teranga.dev / password123 (speaker)");
  console.log("  ✓ sponsor@teranga.dev / password123 (sponsor)");

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. ORGANIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n🏢 Creating organization...");

  await db.collection("organizations").doc(IDS.orgId).set({
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
    createdAt: twoDaysAgo,
    updatedAt: now,
  });

  console.log("  ✓ Teranga Events (org-001)");

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. USER PROFILES
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n📋 Creating user profiles...");

  const userProfiles = [
    {
      id: IDS.organizer, email: "organizer@teranga.dev", displayName: "Moussa Diop",
      roles: ["organizer"], organizationId: IDS.orgId,
      phone: "+221770001234", bio: "Organisateur passionné de tech events à Dakar",
    },
    {
      id: IDS.coOrganizer, email: "coorganizer@teranga.dev", displayName: "Fatou Sall",
      roles: ["co_organizer"], organizationId: IDS.orgId,
      phone: "+221770001235", bio: "Coordinatrice événementielle",
    },
    {
      id: IDS.participant1, email: "participant@teranga.dev", displayName: "Aminata Fall",
      roles: ["participant"], phone: "+221770005678", bio: "Développeuse full-stack passionnée par le mobile",
    },
    {
      id: IDS.participant2, email: "participant2@teranga.dev", displayName: "Ousmane Ndiaye",
      roles: ["participant"], phone: "+221770009999", bio: "Designer UX/UI — Figma addict",
    },
    {
      id: IDS.speakerUser, email: "speaker@teranga.dev", displayName: "Ibrahima Gueye",
      roles: ["speaker"], phone: "+221770007777", bio: "CTO & conférencier tech, expert Flutter et Firebase",
    },
    {
      id: IDS.sponsorUser, email: "sponsor@teranga.dev", displayName: "Aissatou Ba",
      roles: ["sponsor"], phone: "+221770008888", bio: "Directrice marketing chez TechCorp Dakar",
    },
  ];

  for (const profile of userProfiles) {
    await db.collection("users").doc(profile.id).set({
      ...profile,
      photoURL: null,
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
  await db.collection("events").doc(IDS.conference).set({
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
    requiresApproval: false,
    templateId: null,
    createdBy: IDS.organizer,
    updatedBy: IDS.organizer,
    createdAt: twoDaysAgo,
    updatedAt: now,
    publishedAt: yesterday,
  });

  // Event 2: Draft workshop (paid)
  await db.collection("events").doc(IDS.workshop).set({
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
    requiresApproval: false,
    templateId: null,
    createdBy: IDS.organizer,
    updatedBy: IDS.organizer,
    createdAt: yesterday,
    updatedAt: yesterday,
    publishedAt: null,
  });

  // Event 3: Cancelled meetup
  await db.collection("events").doc(IDS.meetup).set({
    id: IDS.meetup,
    organizationId: IDS.orgId,
    title: "Meetup Développeurs Dakar #12",
    slug: "meetup-dev-dakar-12",
    description: "Rencontre mensuelle des développeurs de Dakar. Présentations éclair et networking.",
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
    requiresApproval: false,
    templateId: null,
    createdBy: IDS.organizer,
    updatedBy: IDS.organizer,
    createdAt: twoDaysAgo,
    updatedAt: yesterday,
    publishedAt: twoDaysAgo,
  });

  // Event 4: Published PAID event (for testing payment flow)
  await db.collection("events").doc(IDS.paidEvent).set({
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
    requiresApproval: false,
    templateId: null,
    createdBy: IDS.organizer,
    updatedBy: IDS.organizer,
    createdAt: yesterday,
    updatedAt: now,
    publishedAt: now,
  });

  console.log("  ✓ Dakar Tech Summit 2026 (published, free)");
  console.log("  ✓ Atelier Flutter & Firebase (draft)");
  console.log("  ✓ Meetup Développeurs Dakar #12 (cancelled)");
  console.log("  ✓ Masterclass IA Générative (published, paid)");

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. REGISTRATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n🎫 Creating registrations...");

  const epochBase36 = Date.now().toString(36);

  // Reg 1: Participant 1 → Conference (confirmed, checked in)
  await db.collection("registrations").doc(IDS.reg1).set({
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
  await db.collection("registrations").doc(IDS.reg2).set({
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
  await db.collection("registrations").doc(IDS.reg3).set({
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
  await db.collection("registrations").doc(IDS.reg4).set({
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
  await db.collection("registrations").doc(IDS.reg6).set({
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

  await db.collection("badges").doc("badge-001").set({
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

  await db.collection("badges").doc("badge-002").set({
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
      description: "Panorama des opportunités tech au Sénégal et dans la sous-région. Comment les startups africaines transforment le continent.",
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
      description: "Hands-on : créer une API REST performante de zéro avec Fastify, Zod et TypeScript.",
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
      description: "Débat avec les acteurs de Wave, Orange Money et les fintechs locales sur l'accès aux services financiers.",
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
      description: "Rencontrez les participants, échangez vos cartes et profitez du cocktail offert par nos sponsors.",
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
    await db.collection("sessions").doc(s.id).set({
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

  await db.collection("speakers").doc(IDS.speaker1).set({
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

  await db.collection("speakers").doc(IDS.speaker2).set({
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
    description: "Leader des solutions cloud en Afrique de l'Ouest. Nous accompagnons les entreprises dans leur transformation numérique.",
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

  await db.collection("sponsorLeads").doc("lead-001").set({
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
  await db.collection("payments").doc(IDS.payment1).set({
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

  await db.collection("feedPosts").doc(IDS.post1).set({
    id: IDS.post1,
    eventId: IDS.conference,
    authorId: IDS.organizer,
    authorName: "Moussa Diop",
    authorPhotoURL: null,
    authorRole: "organizer",
    content: "🎉 Bienvenue au Dakar Tech Summit 2026 ! Le programme est en ligne. N'oubliez pas de réserver vos places pour les ateliers. #DTS2026",
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

  await db.collection("feedPosts").doc(IDS.post2).set({
    id: IDS.post2,
    eventId: IDS.conference,
    authorId: IDS.speakerUser,
    authorName: "Ibrahima Gueye",
    authorPhotoURL: null,
    authorRole: "speaker",
    content: "Hâte de vous retrouver pour la keynote ! Je prépare une démo live de Flutter + Firebase qui va vous surprendre 🚀",
    mediaURLs: [],
    likeCount: 5,
    commentCount: 1,
    likedByIds: [IDS.participant1, IDS.participant2, IDS.organizer, IDS.coOrganizer, IDS.sponsorUser],
    isPinned: false,
    isAnnouncement: false,
    createdAt: yesterday,
    updatedAt: yesterday,
    deletedAt: null,
  });

  await db.collection("feedPosts").doc(IDS.post3).set({
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
  await db.collection("conversations").doc(IDS.conv1).set({
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
    content: "Bonjour Ibrahima ! J'ai adoré votre talk au meetup #11. Est-ce qu'on pourrait discuter de Firebase offline ?",
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
  await db.collection("conversations").doc(IDS.conv2).set({
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
    await db.collection("notifications").doc(n.id).set({
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

  await db.collection("broadcasts").doc(IDS.broadcast1).set({
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
    { action: "event.created", entityType: "event", entityId: IDS.conference, actorId: IDS.organizer, details: { title: "Dakar Tech Summit 2026" } },
    { action: "event.published", entityType: "event", entityId: IDS.conference, actorId: IDS.organizer, details: {} },
    { action: "registration.created", entityType: "registration", entityId: IDS.reg1, actorId: IDS.participant1, details: { eventId: IDS.conference } },
    { action: "registration.checked_in", entityType: "registration", entityId: IDS.reg1, actorId: IDS.organizer, details: { method: "qr_scan" } },
    { action: "sponsor.added", entityType: "sponsor", entityId: IDS.sponsor1, actorId: IDS.organizer, details: { companyName: "TechCorp Dakar" } },
  ];

  for (let i = 0; i < auditEvents.length; i++) {
    await db.collection("auditLogs").doc(`audit-${String(i + 1).padStart(3, "0")}`).set({
      id: `audit-${String(i + 1).padStart(3, "0")}`,
      ...auditEvents[i],
      organizationId: IDS.orgId,
      requestId: `seed-req-${i + 1}`,
      createdAt: yesterday,
    });
  }

  console.log(`  ✓ ${auditEvents.length} audit log entries`);

  // ═══════════════════════════════════════════════════════════════════════════
  // DONE
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n" + "═".repeat(60));
  console.log("✅ Seed complete! Data covers Waves 1-8.\n");
  console.log("📊 Summary:");
  console.log("   Users:          6 (organizer, co-organizer, 2 participants, speaker, sponsor)");
  console.log("   Organization:   1");
  console.log("   Events:         4 (2 published, 1 draft, 1 cancelled)");
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
  console.log("   Audit logs:     5");
  console.log("");
  console.log("🔑 Login credentials:");
  console.log("   organizer@teranga.dev    / password123  (organizer)");
  console.log("   coorganizer@teranga.dev  / password123  (co_organizer)");
  console.log("   participant@teranga.dev  / password123  (participant)");
  console.log("   participant2@teranga.dev / password123  (participant)");
  console.log("   speaker@teranga.dev      / password123  (speaker)");
  console.log("   sponsor@teranga.dev      / password123  (sponsor)");
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
