import crypto from "node:crypto";
import { type AuthUser } from "@/middlewares/auth.middleware";
import {
  type Event,
  type Registration,
  type Organization,
  type OrganizationInvite,
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
    ...overrides,
  };
}

export function buildOrganizerUser(organizationId: string, overrides: Partial<AuthUser> = {}): AuthUser {
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
