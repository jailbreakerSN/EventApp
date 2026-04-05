/**
 * Seed Firebase Emulators with test data for local development.
 *
 * Prerequisites:
 *   1. Firebase emulators running: `firebase emulators:start`
 *   2. Run: `npx tsx scripts/seed-emulators.ts`
 *
 * Creates:
 *   - 1 organizer user (login: organizer@teranga.dev / password123)
 *   - 1 participant user (login: participant@teranga.dev / password123)
 *   - 1 organization
 *   - 3 sample events (1 published, 1 draft, 1 cancelled)
 *   - 2 registrations on the published event
 */

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "localhost:9199";

import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// Initialize with emulator — no real credentials needed
const app = initializeApp({ projectId: "teranga-app-990a8" });
const auth = getAuth(app);
const db = getFirestore(app);

const now = new Date().toISOString();
const inOneWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const inTwoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
const inOneMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

/** Create or retrieve a user — idempotent (safe to re-run). */
async function ensureUser(
  uid: string,
  props: { email: string; password: string; displayName: string },
  claims: Record<string, unknown>,
) {
  try {
    await auth.createUser({ uid, ...props, emailVerified: true });
  } catch (err: any) {
    if (err?.errorInfo?.code !== "auth/uid-already-exists") throw err;
    // User exists — update display name in case it changed
    await auth.updateUser(uid, { displayName: props.displayName });
  }
  await auth.setCustomUserClaims(uid, claims);
  return { uid };
}

async function seed() {
  console.log("🌱 Seeding Firebase emulators...\n");

  // ─── 1. Create Users ────────────────────────────────────────────────────────

  console.log("👤 Creating users...");

  const organizer = await ensureUser(
    "organizer-uid-001",
    { email: "organizer@teranga.dev", password: "password123", displayName: "Moussa Diop" },
    { roles: ["organizer"], organizationId: "org-001" },
  );

  const participant = await ensureUser(
    "participant-uid-001",
    { email: "participant@teranga.dev", password: "password123", displayName: "Aminata Fall" },
    { roles: ["participant"] },
  );

  const participant2 = await ensureUser(
    "participant-uid-002",
    { email: "participant2@teranga.dev", password: "password123", displayName: "Ousmane Ndiaye" },
    { roles: ["participant"] },
  );

  console.log("  ✓ organizer@teranga.dev / password123 (organizer)");
  console.log("  ✓ participant@teranga.dev / password123 (participant)");
  console.log("  ✓ participant2@teranga.dev / password123 (participant)");

  // ─── 2. Create Organization ─────────────────────────────────────────────────

  console.log("\n🏢 Creating organization...");

  await db.collection("organizations").doc("org-001").set({
    id: "org-001",
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
    ownerId: organizer.uid,
    memberIds: [organizer.uid],
    createdAt: now,
    updatedAt: now,
  });

  console.log("  ✓ Teranga Events (org-001)");

  // ─── 3. Create User Profiles ────────────────────────────────────────────────

  console.log("\n📋 Creating user profiles...");

  await db.collection("users").doc(organizer.uid).set({
    id: organizer.uid,
    email: "organizer@teranga.dev",
    displayName: "Moussa Diop",
    photoURL: null,
    roles: ["organizer"],
    organizationId: "org-001",
    phone: "+221770001234",
    bio: "Organisateur passionné de tech events à Dakar",
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("users").doc(participant.uid).set({
    id: participant.uid,
    email: "participant@teranga.dev",
    displayName: "Aminata Fall",
    photoURL: null,
    roles: ["participant"],
    phone: "+221770005678",
    bio: "Développeuse full-stack",
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("users").doc(participant2.uid).set({
    id: participant2.uid,
    email: "participant2@teranga.dev",
    displayName: "Ousmane Ndiaye",
    photoURL: null,
    roles: ["participant"],
    phone: "+221770009999",
    bio: "Designer UX/UI",
    createdAt: now,
    updatedAt: now,
  });

  console.log("  ✓ 3 user profiles created");

  // ─── 4. Create Events ───────────────────────────────────────────────────────

  console.log("\n📅 Creating events...");

  // Event 1: Published conference
  await db.collection("events").doc("event-001").set({
    id: "event-001",
    organizationId: "org-001",
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
        soldCount: 2,
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
        soldCount: 0,
        accessZoneIds: [],
        isVisible: true,
      },
    ],
    accessZones: [],
    maxAttendees: 550,
    registeredCount: 2,
    checkedInCount: 0,
    isPublic: true,
    isFeatured: true,
    requiresApproval: false,
    templateId: null,
    createdBy: organizer.uid,
    updatedBy: organizer.uid,
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
  });

  // Event 2: Draft workshop
  await db.collection("events").doc("event-002").set({
    id: "event-002",
    organizationId: "org-001",
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
    createdBy: organizer.uid,
    updatedBy: organizer.uid,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  });

  // Event 3: Cancelled meetup
  await db.collection("events").doc("event-003").set({
    id: "event-003",
    organizationId: "org-001",
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
    startDate: now,
    endDate: now,
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
    createdBy: organizer.uid,
    updatedBy: organizer.uid,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  });

  console.log("  ✓ Dakar Tech Summit 2026 (published)");
  console.log("  ✓ Atelier Flutter & Firebase (draft)");
  console.log("  ✓ Meetup Développeurs Dakar #12 (cancelled)");

  // ─── 5. Create Registrations ────────────────────────────────────────────────

  console.log("\n🎫 Creating registrations...");

  await db.collection("registrations").doc("reg-001").set({
    id: "reg-001",
    eventId: "event-001",
    userId: participant.uid,
    ticketTypeId: "ticket-standard-001",
    status: "confirmed",
    qrCodeValue: `reg-001:event-001:${participant.uid}:${Date.now().toString(36)}:demo-hmac-signature`,
    checkedInAt: null,
    checkedInBy: null,
    accessZoneId: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("registrations").doc("reg-002").set({
    id: "reg-002",
    eventId: "event-001",
    userId: participant2.uid,
    ticketTypeId: "ticket-standard-001",
    status: "pending",
    qrCodeValue: `reg-002:event-001:${participant2.uid}:${Date.now().toString(36)}:demo-hmac-signature`,
    checkedInAt: null,
    checkedInBy: null,
    accessZoneId: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
  });

  console.log("  ✓ Aminata Fall → Dakar Tech Summit (confirmed)");
  console.log("  ✓ Ousmane Ndiaye → Dakar Tech Summit (pending)");

  // ─── 6. Create Badges ──────────────────────────────────────────────────────

  console.log("\n🏷️  Creating badges...");

  await db.collection("badges").doc("badge-001").set({
    id: "badge-001",
    registrationId: "reg-001",
    eventId: "event-001",
    userId: participant.uid,
    templateId: null,
    pdfURL: null,
    qrCodeValue: `reg-001:event-001:${participant.uid}:${Date.now().toString(36)}:demo-hmac-signature`,
    status: "pending",
    error: null,
    generatedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  console.log("  ✓ Badge for Aminata Fall (pending generation)");

  // ─── Done ──────────────────────────────────────────────────────────────────

  console.log("\n✅ Seed complete! You can now:");
  console.log("   1. Start API:  npm run api:dev");
  console.log("   2. Start Web:  npm run web:dev");
  console.log("   3. Login at http://localhost:3001 with:");
  console.log("      - organizer@teranga.dev / password123 (organizer)");
  console.log("      - participant@teranga.dev / password123 (participant)");
  console.log("   4. Firebase Emulator UI: http://localhost:4000");
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
