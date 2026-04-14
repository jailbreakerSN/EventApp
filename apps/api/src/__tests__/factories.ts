import crypto from "node:crypto";
import { type AuthUser } from "@/middlewares/auth.middleware";
import {
  type Event,
  type Registration,
  type Organization,
  type OrganizationInvite,
  type Payment,
  type SpeakerProfile,
  type SponsorProfile,
  type Broadcast,
  type Venue,
} from "@teranga/shared-types";

function uid(): string {
  return `test-${crypto.randomUUID()}`;
}

// ─── Auth User Factory ───────────────────────────────────────────────────────

export function buildAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    uid: uid(),
    email: `user-${uid()}@test.teranga.events`,
    roles: ["participant"],
    organizationId: undefined,
    // Default to verified — most tests simulate the happy path. Tests
    // exercising the requireEmailVerified gate explicitly override to false.
    emailVerified: true,
    ...overrides,
  };
}

export function buildOrganizerUser(
  organizationId: string,
  overrides: Partial<AuthUser> = {},
): AuthUser {
  return buildAuthUser({
    roles: ["organizer"],
    organizationId,
    ...overrides,
  });
}

export function buildStaffUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return buildAuthUser({
    roles: ["staff"],
    ...overrides,
  });
}

export function buildSuperAdmin(overrides: Partial<AuthUser> = {}): AuthUser {
  return buildAuthUser({
    roles: ["super_admin"],
    ...overrides,
  });
}

export function buildVenueManager(
  organizationId: string,
  overrides: Partial<AuthUser> = {},
): AuthUser {
  return buildAuthUser({
    roles: ["venue_manager"],
    organizationId,
    ...overrides,
  });
}

// ─── Event Factory ───────────────────────────────────────────────────────────

export function buildEvent(overrides: Partial<Event> = {}): Event {
  const id = uid();
  const now = new Date().toISOString();
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString();

  return {
    id,
    organizationId: uid(),
    title: `Test Event ${uid()}`,
    slug: `test-event-${uid()}`,
    description: "A test event for unit testing",
    shortDescription: null,
    coverImageURL: null,
    bannerImageURL: null,
    category: "conference",
    tags: [],
    format: "in_person",
    status: "published",
    location: {
      name: "Test Venue",
      address: "123 Test St",
      city: "Dakar",
      country: "SN",
    },
    startDate: tomorrow,
    endDate: nextWeek,
    timezone: "Africa/Dakar",
    ticketTypes: [
      {
        id: "ticket-standard",
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
    createdBy: uid(),
    updatedBy: uid(),
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
    ...overrides,
  };
}

// ─── Registration Factory ────────────────────────────────────────────────────

export function buildRegistration(overrides: Partial<Registration> = {}): Registration {
  const id = uid();
  const now = new Date().toISOString();

  return {
    id,
    eventId: uid(),
    userId: uid(),
    ticketTypeId: "ticket-standard",
    status: "confirmed",
    qrCodeValue: `${id}:event123:user123:fakesignature`,
    checkedInAt: null,
    checkedInBy: null,
    accessZoneId: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── Organization Factory ────────────────────────────────────────────────────

export function buildOrganization(overrides: Partial<Organization> = {}): Organization {
  const id = uid();
  const now = new Date().toISOString();

  return {
    id,
    name: `Test Org ${uid()}`,
    slug: `test-org-${uid()}`,
    logoURL: null,
    coverURL: null,
    website: null,
    description: null,
    country: "SN",
    city: null,
    phone: null,
    email: null,
    plan: "free",
    ownerId: uid(),
    memberIds: [],
    isVerified: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── Invite Factory ─────────────────────────────────────────────────────────

export function buildInvite(overrides: Partial<OrganizationInvite> = {}): OrganizationInvite {
  const id = uid();
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  return {
    id,
    organizationId: uid(),
    organizationName: "Test Org",
    email: `invite-${uid()}@test.teranga.events`,
    role: "member",
    status: "pending",
    invitedBy: uid(),
    invitedByName: null,
    token: crypto.randomBytes(32).toString("hex"),
    expiresAt: expires,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── Payment Factory ─────────────────────────────────────────────────────────

export function buildPayment(overrides: Partial<Payment> = {}): Payment {
  const id = uid();
  const now = new Date().toISOString();

  return {
    id,
    registrationId: uid(),
    eventId: uid(),
    organizationId: uid(),
    userId: uid(),
    amount: 5000,
    currency: "XOF",
    method: "mock",
    providerTransactionId: `mock_${crypto.randomBytes(12).toString("hex")}`,
    status: "processing",
    redirectUrl: "http://localhost:3000/mock-checkout/test",
    callbackUrl: "http://localhost:3000/v1/payments/webhook",
    returnUrl: "http://localhost:3002/register/ev/payment-status",
    providerMetadata: null,
    failureReason: null,
    refundedAmount: 0,
    initiatedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Payment;
}

// ─── Speaker Factory ────────────────────────────────────────────────────────

export function buildSpeaker(overrides: Partial<SpeakerProfile> = {}): SpeakerProfile {
  const id = uid();
  const now = new Date().toISOString();

  return {
    id,
    userId: uid(),
    eventId: uid(),
    organizationId: uid(),
    name: `Speaker ${uid()}`,
    title: "CTO",
    company: "TechCorp",
    bio: "An expert in their field",
    photoURL: null,
    socialLinks: null,
    topics: ["tech", "innovation"],
    sessionIds: [],
    isConfirmed: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── Sponsor Factory ────────────────────────────────────────────────────────

export function buildSponsor(overrides: Partial<SponsorProfile> = {}): SponsorProfile {
  const id = uid();
  const now = new Date().toISOString();

  return {
    id,
    userId: uid(),
    eventId: uid(),
    organizationId: uid(),
    companyName: `Sponsor Corp ${uid()}`,
    logoURL: null,
    description: "A great sponsor",
    website: null,
    tier: "gold",
    boothTitle: null,
    boothDescription: null,
    boothBannerURL: null,
    ctaLabel: null,
    ctaUrl: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── Venue Factory ─────────────────────────────────────────────────────────

export function buildVenue(overrides: Partial<Venue> = {}): Venue {
  const id = uid();
  const now = new Date().toISOString();

  return {
    id,
    name: `Test Venue ${uid()}`,
    slug: `test-venue-${uid()}`,
    description: "A test venue for unit testing",
    address: {
      street: "123 Test St",
      city: "Dakar",
      country: "SN",
    },
    venueType: "conference_center",
    capacity: {
      min: 50,
      max: 500,
      configurations: [{ name: "Theatre", capacity: 500 }],
    },
    amenities: ["wifi", "parking"],
    photos: [],
    contactName: "Test Contact",
    contactEmail: `venue-${uid()}@test.teranga.events`,
    contactPhone: null,
    website: null,
    hostOrganizationId: null,
    status: "approved",
    isFeatured: false,
    rating: null,
    eventCount: 0,
    createdBy: uid(),
    updatedBy: uid(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ─── Broadcast Factory ──────────────────────────────────────────────────────

export function buildBroadcast(overrides: Partial<Broadcast> = {}): Broadcast {
  const id = uid();
  const now = new Date().toISOString();

  return {
    id,
    eventId: uid(),
    organizationId: uid(),
    title: "Test Broadcast",
    body: "Hello participants!",
    channels: ["push", "in_app"],
    recipientFilter: "all",
    recipientCount: 10,
    sentCount: 10,
    failedCount: 0,
    status: "sent",
    createdBy: uid(),
    createdAt: now,
    sentAt: now,
    ...overrides,
  };
}
