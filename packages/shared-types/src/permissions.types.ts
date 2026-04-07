import { z } from "zod";

// ─── Granular Permissions ─────────────────────────────────────────────────────
// Format: "resource:action"
// These are the atomic units of access control.

export const PermissionSchema = z.enum([
  // ── Platform ──────────────────────────────────────────────────────────────
  "platform:manage",           // super admin — full platform control

  // ── Organization ──────────────────────────────────────────────────────────
  "organization:create",
  "organization:read",
  "organization:update",
  "organization:delete",
  "organization:manage_members", // add/remove members, change their roles
  "organization:manage_billing", // plans, payment methods

  // ── Event ─────────────────────────────────────────────────────────────────
  "event:create",
  "event:read",
  "event:update",
  "event:delete",              // soft-delete (archive)
  "event:publish",
  "event:manage_sessions",     // create/edit/delete sessions
  "event:manage_speakers",
  "event:manage_sponsors",
  "event:view_analytics",

  // ── Registration ──────────────────────────────────────────────────────────
  "registration:create",       // register self for events
  "registration:read_own",     // view own registrations
  "registration:read_all",     // view all registrations for an event (organizer/staff)
  "registration:cancel_own",
  "registration:cancel_any",   // cancel anyone's registration
  "registration:approve",      // approve waitlisted/pending registrations
  "registration:export",       // export participant CSV

  // ── Check-in ──────────────────────────────────────────────────────────────
  "checkin:scan",              // scan QR badges
  "checkin:manual",            // manual check-in without QR
  "checkin:view_log",          // view check-in history
  "checkin:sync_offline",      // download offline sync data

  // ── Badge ─────────────────────────────────────────────────────────────────
  "badge:view_own",            // view/download own badge
  "badge:generate",            // trigger badge generation for participants
  "badge:manage_templates",    // create/edit badge templates
  "badge:bulk_generate",       // generate badges in bulk

  // ── Communication ─────────────────────────────────────────────────────────
  "notification:send",         // send push/email/SMS to participants
  "notification:read_own",     // view own notifications

  "feed:read",                 // read event feed posts
  "feed:create_post",          // create a post in the event feed
  "feed:create_announcement",  // create an announcement (pushed to all)
  "feed:delete_post",          // delete own posts or comments
  "feed:manage_content",       // pin/unpin posts, moderate content (admin)
  "feed:moderate",             // delete/pin posts

  "messaging:send",            // send direct messages
  "messaging:read_own",        // read own conversations

  // ── Profile ───────────────────────────────────────────────────────────────
  "profile:read_own",
  "profile:update_own",
  "profile:read_any",          // view any user's public profile (for networking)

  // ── Payment ────────────────────────────────────────────────────────────────
  "payment:initiate",          // initiate payment for registration
  "payment:read_own",          // view own payment history
  "payment:read_all",          // view all payments for an event (organizer)
  "payment:refund",            // issue refunds
  "payment:view_reports",      // view financial reports

  // ── Sponsor ───────────────────────────────────────────────────────────────
  "sponsor:manage_booth",      // manage exhibition page
  "sponsor:collect_leads",     // scan participant QR for lead capture
  "sponsor:view_leads",

  // ── Payout ────────────────────────────────────────────────────────────────
  "payout:read",               // view payout history for organization
  "payout:create",             // create a payout request

  // ── Broadcast ─────────────────────────────────────────────────────────────
  "broadcast:send",            // send broadcast to event participants
  "broadcast:read",            // view broadcast history

  // ── Speaker ───────────────────────────────────────────────────────────────
  "speaker:read",              // view speaker profiles
  "speaker:update_own",        // speaker edits own profile
]);

export type Permission = z.infer<typeof PermissionSchema>;

// ─── System Roles ─────────────────────────────────────────────────────────────
// Roles are named bundles of permissions. The system defines defaults,
// but organizations can create custom roles in the future.

export const SystemRoleSchema = z.enum([
  "participant",
  "organizer",
  "co_organizer",     // invited to manage specific events, not entire org
  "speaker",
  "sponsor",
  "staff",            // QR scanner / access control
  "super_admin",
]);

export type SystemRole = z.infer<typeof SystemRoleSchema>;

// ─── Role → Permission Mapping ────────────────────────────────────────────────
// Default permissions per system role. Can be overridden per organization.

export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRole, readonly Permission[]> = {
  participant: [
    "registration:create",
    "registration:read_own",
    "registration:cancel_own",
    "badge:view_own",
    "notification:read_own",
    "feed:read",
    "feed:create_post",
    "feed:delete_post",
    "messaging:send",
    "messaging:read_own",
    "profile:read_own",
    "profile:update_own",
    "profile:read_any",
    "payment:initiate",
    "payment:read_own",
  ],

  organizer: [
    // Everything a participant can do
    "registration:create",
    "registration:read_own",
    "registration:cancel_own",
    "badge:view_own",
    "notification:read_own",
    "feed:read",
    "feed:create_post",
    "messaging:send",
    "messaging:read_own",
    "profile:read_own",
    "profile:update_own",
    "profile:read_any",
    // Plus organization management
    "organization:read",
    "organization:update",
    "organization:manage_members",
    "organization:manage_billing",
    // Plus full event management
    "event:create",
    "event:read",
    "event:update",
    "event:delete",
    "event:publish",
    "event:manage_sessions",
    "event:manage_speakers",
    "event:manage_sponsors",
    "event:view_analytics",
    // Plus registration management
    "registration:read_all",
    "registration:cancel_any",
    "registration:approve",
    "registration:export",
    // Plus check-in
    "checkin:scan",
    "checkin:manual",
    "checkin:view_log",
    "checkin:sync_offline",
    // Plus badges
    "badge:generate",
    "badge:manage_templates",
    "badge:bulk_generate",
    // Plus communication
    "notification:send",
    "feed:create_announcement",
    "feed:delete_post",
    "feed:manage_content",
    "feed:moderate",
    "payment:initiate",
    "payment:read_own",
    "payment:read_all",
    "payment:refund",
    "payment:view_reports",
    "payout:read",
    "payout:create",
    "broadcast:send",
    "broadcast:read",
    "speaker:read",
  ],

  co_organizer: [
    // Same as participant base
    "registration:create",
    "registration:read_own",
    "registration:cancel_own",
    "badge:view_own",
    "notification:read_own",
    "feed:read",
    "feed:create_post",
    "messaging:send",
    "messaging:read_own",
    "profile:read_own",
    "profile:update_own",
    "profile:read_any",
    // Plus event management (but not org management)
    "event:read",
    "event:update",
    "event:publish",
    "event:manage_sessions",
    "event:manage_speakers",
    "event:manage_sponsors",
    "event:view_analytics",
    // Plus registration
    "registration:read_all",
    "registration:approve",
    "registration:export",
    // Plus check-in
    "checkin:scan",
    "checkin:manual",
    "checkin:view_log",
    "checkin:sync_offline",
    // Plus badges
    "badge:generate",
    "badge:bulk_generate",
    // Plus announcements
    "notification:send",
    "feed:create_announcement",
    "feed:delete_post",
    "feed:manage_content",
    "feed:moderate",
    "broadcast:send",
    "broadcast:read",
    "speaker:read",
  ],

  speaker: [
    "registration:read_own",
    "badge:view_own",
    "notification:read_own",
    "feed:read",
    "feed:create_post",
    "feed:delete_post",
    "messaging:send",
    "messaging:read_own",
    "profile:read_own",
    "profile:update_own",
    "profile:read_any",
    "event:read",
    "speaker:read",
    "speaker:update_own",
  ],

  sponsor: [
    "registration:read_own",
    "badge:view_own",
    "notification:read_own",
    "feed:read",
    "feed:create_post",
    "feed:delete_post",
    "messaging:send",
    "messaging:read_own",
    "profile:read_own",
    "profile:update_own",
    "profile:read_any",
    "event:read",
    "sponsor:manage_booth",
    "sponsor:collect_leads",
    "sponsor:view_leads",
  ],

  staff: [
    "registration:read_own",
    "badge:view_own",
    "notification:read_own",
    "feed:read",
    "messaging:read_own",
    "profile:read_own",
    "profile:update_own",
    "event:read",
    // Core staff capabilities
    "registration:read_all",
    "checkin:scan",
    "checkin:manual",
    "checkin:view_log",
    "checkin:sync_offline",
  ],

  super_admin: [
    "platform:manage", // Implies ALL permissions
  ],
} as const;

// ─── Resource-Scoped Role Assignment ──────────────────────────────────────────
// A user can have different roles at different scopes:
//   - Global: super_admin (platform-wide)
//   - Organization: organizer at OrgA (all events in OrgA)
//   - Event: co_organizer at Event123 (just that event), staff at Event456

export const RoleScopeSchema = z.enum(["global", "organization", "event"]);
export type RoleScope = z.infer<typeof RoleScopeSchema>;

export const RoleAssignmentSchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: SystemRoleSchema,
  scope: RoleScopeSchema,
  // The resource this role is scoped to (null for global)
  organizationId: z.string().nullable(),
  eventId: z.string().nullable(),        // for event-scoped roles (co_organizer, staff, speaker, sponsor)
  grantedBy: z.string(),                 // uid of who granted this role
  grantedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable().optional(), // for temporary roles (e.g., staff for one event)
  isActive: z.boolean().default(true),
});

export type RoleAssignment = z.infer<typeof RoleAssignmentSchema>;

// ─── Helper: Resolve Permissions ──────────────────────────────────────────────
// Given a user's role assignments, resolve their effective permissions
// for a specific resource context.

export interface PermissionContext {
  organizationId?: string;
  eventId?: string;
}

/**
 * Resolve a user's effective permissions given their role assignments
 * and the resource context they're accessing.
 *
 * Rules:
 * 1. super_admin → ALL permissions (platform:manage implies everything)
 * 2. Organization-scoped roles apply to all events within that org
 * 3. Event-scoped roles apply only to that specific event
 * 4. Global participant role is the baseline
 */
export function resolvePermissions(
  assignments: RoleAssignment[],
  context: PermissionContext,
): Set<Permission> {
  const permissions = new Set<Permission>();

  for (const assignment of assignments) {
    if (!assignment.isActive) continue;

    // Check if this assignment applies to the current context
    const applies = isAssignmentApplicable(assignment, context);
    if (!applies) continue;

    // Get permissions for this role
    const rolePerms = DEFAULT_ROLE_PERMISSIONS[assignment.role];
    if (!rolePerms) continue;

    // super_admin check — platform:manage means everything
    if (rolePerms.includes("platform:manage")) {
      // Return ALL permissions
      const allPerms = PermissionSchema.options;
      return new Set(allPerms);
    }

    for (const perm of rolePerms) {
      permissions.add(perm);
    }
  }

  return permissions;
}

function isAssignmentApplicable(
  assignment: RoleAssignment,
  context: PermissionContext,
): boolean {
  switch (assignment.scope) {
    case "global":
      return true; // Always applies

    case "organization":
      // Applies if the context is within this organization
      return (
        !context.organizationId ||
        assignment.organizationId === context.organizationId
      );

    case "event":
      // Applies if accessing this specific event
      return (
        !context.eventId || assignment.eventId === context.eventId
      );

    default:
      return false;
  }
}

/**
 * Check if a set of resolved permissions includes the required permission.
 */
export function hasPermission(
  permissions: Set<Permission>,
  required: Permission,
): boolean {
  if (permissions.has("platform:manage")) return true;
  return permissions.has(required);
}

/**
 * Check if a set of resolved permissions includes ALL of the required permissions.
 */
export function hasAllPermissions(
  permissions: Set<Permission>,
  required: Permission[],
): boolean {
  if (permissions.has("platform:manage")) return true;
  return required.every((p) => permissions.has(p));
}

/**
 * Check if a set of resolved permissions includes ANY of the required permissions.
 */
export function hasAnyPermission(
  permissions: Set<Permission>,
  required: Permission[],
): boolean {
  if (permissions.has("platform:manage")) return true;
  return required.some((p) => permissions.has(p));
}
