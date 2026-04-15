import {
  type Organization,
  type OrganizationPlan,
  type Subscription,
  type Plan,
  type PlanFeatures,
  type Event,
  type Registration,
  PLAN_LIMITS,
  PLAN_DISPLAY,
  PLAN_LIMIT_UNLIMITED,
} from "@teranga/shared-types";
import { db, COLLECTIONS } from "@/config/firebase";
import { signQrPayload } from "@/services/qr-signing";

// ── Emulator control ────────────────────────────────────────────────────────

/**
 * Clear every document in every collection on the emulator for the current
 * project, via the emulator's admin REST endpoint. This is dramatically
 * cheaper than walking collections and deleting docs one-by-one, and it
 * handles subcollections automatically.
 */
export async function clearFirestore(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!host || !projectId) {
    throw new Error("FIRESTORE_EMULATOR_HOST and FIREBASE_PROJECT_ID must be set");
  }
  const url = `http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(`Failed to clear Firestore emulator: ${res.status} ${await res.text()}`);
  }
}

// ── Plan catalog seeding ────────────────────────────────────────────────────

const PLAN_ORDER: readonly OrganizationPlan[] = ["free", "starter", "pro", "enterprise"];

function toStored(n: number): number {
  return Number.isFinite(n) ? n : PLAN_LIMIT_UNLIMITED;
}

function buildSystemPlanDoc(key: OrganizationPlan, sortOrder: number, now: string): Plan {
  const limits = PLAN_LIMITS[key];
  const display = PLAN_DISPLAY[key];
  const features: PlanFeatures = limits.features;
  const pricingModel: Plan["pricingModel"] =
    key === "free" ? "free" : key === "enterprise" ? "custom" : "fixed";

  return {
    id: key,
    key,
    name: display.name,
    description: { fr: `Plan ${key}`, en: `Plan ${key}` },
    pricingModel,
    priceXof: display.priceXof,
    currency: "XOF",
    limits: {
      maxEvents: toStored(limits.maxEvents),
      maxParticipantsPerEvent: toStored(limits.maxParticipantsPerEvent),
      maxMembers: toStored(limits.maxMembers),
    },
    features,
    isSystem: true,
    isPublic: true,
    isArchived: false,
    sortOrder,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  } as Plan;
}

/**
 * Seed the four system plans with deterministic ids (= plan key). Idempotent.
 * Returns the seeded docs so tests can assert against them.
 */
export async function seedSystemPlans(): Promise<Plan[]> {
  const now = new Date().toISOString();
  const docs = PLAN_ORDER.map((key, i) => buildSystemPlanDoc(key, i, now));
  const batch = db.batch();
  for (const doc of docs) {
    batch.set(db.collection(COLLECTIONS.PLANS).doc(doc.id), doc);
  }
  await batch.commit();
  return docs;
}

// ── Org + subscription factories (Firestore-backed) ─────────────────────────

/**
 * Build an org document with denormalized effective fields pre-populated
 * for the given plan tier and write it to the emulator.
 *
 * Returns the org's id so callers can pass it to services.
 */
export async function createOrgOnPlan(
  plan: OrganizationPlan,
  overrides: Partial<Organization> = {},
): Promise<{ id: string; org: Organization }> {
  const id = overrides.id ?? `org-${plan}-${Math.random().toString(36).slice(2, 8)}`;
  const legacy = PLAN_LIMITS[plan];
  const now = new Date().toISOString();

  const org: Organization = {
    id,
    name: `Org ${plan}`,
    slug: `org-${plan}-${id.slice(-4)}`,
    logoURL: null,
    coverURL: null,
    website: null,
    description: null,
    country: "SN",
    city: null,
    phone: null,
    email: null,
    plan,
    ownerId: `owner-${id}`,
    memberIds: [],
    isVerified: false,
    isActive: true,
    effectiveLimits: {
      maxEvents: toStored(legacy.maxEvents),
      maxParticipantsPerEvent: toStored(legacy.maxParticipantsPerEvent),
      maxMembers: toStored(legacy.maxMembers),
    },
    effectiveFeatures: { ...legacy.features },
    effectivePlanKey: plan,
    effectiveComputedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Organization;

  await db.collection(COLLECTIONS.ORGANIZATIONS).doc(id).set(org);
  return { id, org };
}

/**
 * Create a subscription doc for an org, returning the id.
 *
 * The default shape matches what `subscription.service.upgrade()` would
 * write: `active` status, 30-day period, `planId` pointing at the system
 * plan doc.
 */
export async function createSubscription(
  orgId: string,
  plan: OrganizationPlan,
  overrides: Partial<Subscription> = {},
): Promise<Subscription> {
  const id = overrides.id ?? `sub-${orgId}`;
  const now = new Date().toISOString();
  const periodEnd =
    overrides.currentPeriodEnd ?? new Date(Date.now() + 30 * 86400000).toISOString();

  const sub: Subscription = {
    id,
    organizationId: orgId,
    plan,
    planId: plan, // system plans have deterministic ids = key
    status: "active",
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    cancelledAt: null,
    paymentMethod: null,
    priceXof: PLAN_DISPLAY[plan].priceXof,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Subscription;

  await db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(id).set(sub);
  return sub;
}

// ── Convenience readers ─────────────────────────────────────────────────────

export async function readOrg(orgId: string): Promise<Organization> {
  const snap = await db.collection(COLLECTIONS.ORGANIZATIONS).doc(orgId).get();
  if (!snap.exists) throw new Error(`Organization ${orgId} not found`);
  return { id: snap.id, ...(snap.data() as Omit<Organization, "id">) } as Organization;
}

export async function readSubscription(subId: string): Promise<Subscription | null> {
  const snap = await db.collection(COLLECTIONS.SUBSCRIPTIONS).doc(subId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<Subscription, "id">) } as Subscription;
}

export async function readPlan(planId: string): Promise<Plan | null> {
  const snap = await db.collection(COLLECTIONS.PLANS).doc(planId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<Plan, "id">) } as Plan;
}

export async function readEvent(eventId: string): Promise<Event | null> {
  const snap = await db.collection(COLLECTIONS.EVENTS).doc(eventId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<Event, "id">) } as Event;
}

export async function readRegistration(regId: string): Promise<Registration | null> {
  const snap = await db.collection(COLLECTIONS.REGISTRATIONS).doc(regId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<Registration, "id">) } as Registration;
}

// ── Event / Registration factories (Firestore-backed) ──────────────────────

/**
 * Write a minimal published event under an org with one free ticket type.
 * Callers can override any field (e.g. `status: "draft"`, `maxAttendees: 1`).
 *
 * Defaults are geared at registration/check-in integration tests:
 *  - one ticket type `t1` with 100 capacity, 0 sold
 *  - startDate = tomorrow (so the plan-limit grace period does NOT apply)
 *  - status = "published"
 */
export async function createEvent(orgId: string, overrides: Partial<Event> = {}): Promise<Event> {
  const id = overrides.id ?? `evt-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString();

  const event: Event = {
    id,
    organizationId: orgId,
    title: `Event ${id}`,
    slug: `event-${id}`,
    description: "Integration-seeded event",
    shortDescription: null,
    coverImageURL: null,
    bannerImageURL: null,
    category: "conference",
    tags: [],
    format: "in_person",
    status: "published",
    location: { name: "Test Venue", address: "1 Rue", city: "Dakar", country: "SN" },
    startDate: tomorrow,
    endDate: nextWeek,
    timezone: "Africa/Dakar",
    ticketTypes: [
      {
        id: "t1",
        name: "Standard",
        price: 0,
        currency: "XOF",
        totalQuantity: 100,
        soldCount: 0,
        accessZoneIds: [],
        isVisible: true,
      },
    ],
    accessZones: [],
    maxAttendees: 100,
    registeredCount: 0,
    checkedInCount: 0,
    isPublic: true,
    isFeatured: false,
    venueId: null,
    venueName: null,
    requiresApproval: false,
    templateId: null,
    createdBy: `owner-${orgId}`,
    updatedBy: `owner-${orgId}`,
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
    ...overrides,
  } as Event;

  await db.collection(COLLECTIONS.EVENTS).doc(id).set(event);
  return event;
}

/**
 * Write a registration doc with a validly-signed QR payload. The QR is
 * signed using the same helper the production service uses so check-in
 * flows can verify against the same secret.
 */
export async function createRegistration(
  eventId: string,
  userId: string,
  overrides: Partial<Registration> = {},
): Promise<Registration> {
  const id = overrides.id ?? `reg-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  const qrCodeValue = overrides.qrCodeValue ?? signQrPayload(id, eventId, userId);

  const reg: Registration = {
    id,
    eventId,
    userId,
    ticketTypeId: "t1",
    status: "confirmed",
    qrCodeValue,
    checkedInAt: null,
    checkedInBy: null,
    accessZoneId: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Registration;

  await db.collection(COLLECTIONS.REGISTRATIONS).doc(id).set(reg);
  return reg;
}
