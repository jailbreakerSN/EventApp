import { z } from "zod";

// ─── Granular Permissions ─────────────────────────────────────────────────────
// Format: "resource:action"
// These are the atomic units of access control.

export const PermissionSchema = z.enum([
  // ── Platform ──────────────────────────────────────────────────────────────
  "platform:manage", // super admin — full platform control
  /**
   * T5.2 — narrow audit-read capability. Every `platform:*` operator
   * role holds this so they can read the cross-tenant audit log, but
   * non-platform roles (organizer, co_organizer, etc.) do NOT — even
   * if they hold `profile:read_any` for their own org context. The
   * audit route gates on
   * `requireAnyPermission(["platform:audit_read", "platform:manage"])`
   * so super_admin still passes via the safety-net.
   */
  "platform:audit_read",

  // ── Organization ──────────────────────────────────────────────────────────
  "organization:create",
  "organization:read",
  "organization:update",
  "organization:delete",
  "organization:manage_members", // add/remove members, change their roles
  "organization:manage_billing", // plans, payment methods

  // ── Plan Catalog (superadmin) ─────────────────────────────────────────────
  "plan:manage", // create, edit, archive catalog plans
  "subscription:override", // assign a plan / custom overrides to an org

  // ── Event ─────────────────────────────────────────────────────────────────
  "event:create",
  "event:read",
  "event:update",
  "event:delete", // soft-delete (archive)
  "event:publish",
  "event:manage_sessions", // create/edit/delete sessions
  "event:manage_speakers",
  "event:manage_sponsors",
  "event:view_analytics",

  // ── Registration ──────────────────────────────────────────────────────────
  "registration:create", // register self for events
  "registration:read_own", // view own registrations
  "registration:read_all", // view all registrations for an event (organizer/staff)
  "registration:cancel_own",
  "registration:cancel_any", // cancel anyone's registration
  "registration:approve", // approve waitlisted/pending registrations
  "registration:export", // export participant CSV

  // ── Check-in ──────────────────────────────────────────────────────────────
  "checkin:scan", // scan QR badges
  "checkin:manual", // manual check-in without QR
  "checkin:view_log", // view check-in history
  "checkin:sync_offline", // download offline sync data

  // ── Badge ─────────────────────────────────────────────────────────────────
  "badge:view_own", // view/download own badge
  "badge:generate", // trigger badge generation for participants
  "badge:manage_templates", // create/edit badge templates
  "badge:bulk_generate", // generate badges in bulk

  // ── Communication ─────────────────────────────────────────────────────────
  "notification:send", // send push/email/SMS to participants
  "notification:read_own", // view own notifications

  "feed:read", // read event feed posts
  "feed:create_post", // create a post in the event feed
  "feed:create_announcement", // create an announcement (pushed to all)
  "feed:delete_post", // delete own posts or comments
  "feed:manage_content", // pin/unpin posts, moderate content (admin)
  "feed:moderate", // delete/pin posts

  "messaging:send", // send direct messages
  "messaging:read_own", // read own conversations

  // ── Profile ───────────────────────────────────────────────────────────────
  "profile:read_own",
  "profile:update_own",
  "profile:read_any", // view any user's public profile (for networking)

  // ── Payment ────────────────────────────────────────────────────────────────
  "payment:initiate", // initiate payment for registration
  "payment:read_own", // view own payment history
  "payment:read_all", // view all payments for an event (organizer)
  "payment:refund", // issue refunds
  "payment:view_reports", // view financial reports

  // ── Sponsor ───────────────────────────────────────────────────────────────
  "sponsor:manage_booth", // manage exhibition page
  "sponsor:collect_leads", // scan participant QR for lead capture
  "sponsor:view_leads",

  // ── Payout ────────────────────────────────────────────────────────────────
  "payout:read", // view payout history for organization
  "payout:create", // create a payout request

  // ── Broadcast ─────────────────────────────────────────────────────────────
  "broadcast:send", // send broadcast to event participants
  "broadcast:read", // view broadcast history

  // ── Speaker ───────────────────────────────────────────────────────────────
  "speaker:read", // view speaker profiles
  "speaker:update_own", // speaker edits own profile

  // ── Venue ─────────────────────────────────────────────────────────────────
  "venue:create", // create a venue (admin or host org)
  "venue:read", // view venue info
  "venue:update", // host manages own venue
  "venue:approve", // admin approves venue applications
  "venue:manage_all", // admin manages any venue
  "venue:view_events", // host sees events at their venue
  "venue:analytics", // host views venue analytics
]);

export type Permission = z.infer<typeof PermissionSchema>;

// ─── System Roles ─────────────────────────────────────────────────────────────
// Roles are named bundles of permissions. The system defines defaults,
// but organizations can create custom roles in the future.

export const SystemRoleSchema = z.enum([
  "participant",
  "organizer",
  "co_organizer", // invited to manage specific events, not entire org
  "speaker",
  "sponsor",
  "staff", // QR scanner / access control
  "venue_manager", // venue host — manages venue profile & sees events
  "super_admin",
  // ── Phase 4 (admin overhaul) — granular platform admin roles ──────────
  // Introduced alongside `super_admin` with the same `platform:manage`
  // permission so the existing route gates keep working. They exist
  // today mainly as AUDIT signals (recorded in `actorRole`) so we can
  // tag which admin did what without forcing a big-bang rewrite of
  // every permission check. Future commits can progressively tighten
  // per-route gates (e.g. `platform:finance` ← subscription:* only).
  "platform:super_admin",
  "platform:support",
  "platform:finance",
  "platform:ops",
  "platform:security",
]);

export type SystemRole = z.infer<typeof SystemRoleSchema>;

/**
 * Roles that operate the platform itself (as opposed to running events
 * on it). Canonical list shared by every app: API middlewares gate
 * admin-only routes on this set, the web-backoffice derives its
 * `(admin)` shell access list from it, audit records stamp the narrowest
 * entry as `actorRole`. When a new admin subrole lands, adding it
 * here and mapping permissions in `DEFAULT_ROLE_PERMISSIONS` is the
 * only code change required.
 */
export const ADMIN_SYSTEM_ROLES = [
  "super_admin",
  "platform:super_admin",
  "platform:support",
  "platform:finance",
  "platform:ops",
  "platform:security",
] as const satisfies readonly SystemRole[];

export type AdminSystemRole = (typeof ADMIN_SYSTEM_ROLES)[number];

/** Cheap `roles.some(isAdminSystemRole)` predicate. */
export function isAdminSystemRole(role: string): role is AdminSystemRole {
  return (ADMIN_SYSTEM_ROLES as readonly string[]).includes(role);
}

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

  venue_manager: [
    // Participant base
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
    // Venue-specific
    "venue:read",
    "venue:update",
    "venue:view_events",
    "venue:analytics",
  ],

  super_admin: [
    "platform:manage", // Implies ALL permissions
  ],

  // ── Phase 4 — granular platform roles (T4.1 tightening) ──────────────
  // Previously every `platform:*` role aliased `platform:manage` so they
  // had the full super-admin toolbox. T4.1 narrows them to the concrete
  // capabilities each persona actually needs. The mapping below reflects
  // the role's audit-tag intent:
  //
  //   platform:super_admin — full platform control (parity with super_admin).
  //   platform:support     — user + org look-up + impersonation, no billing,
  //                          no plan edits, no destructive toggles.
  //   platform:finance     — subscriptions, plans, payments, payouts. No user
  //                          or org role edits, no impersonation.
  //   platform:ops         — jobs, webhooks, feature flags, announcements.
  //                          Observability of everything (audit:read) without
  //                          write access to money or identity.
  //   platform:security    — audit search, impersonation (security response),
  //                          but no billing and no content moderation.
  //
  // Migration note: every `platform:*` user STILL gets `platform:manage`
  // as a safety-net so routes that haven't yet been tightened keep
  // working. Tightening a route means migrating its `requirePermission
  // ("platform:manage")` to the narrowest applicable permission (e.g.
  // `requireAnyPermission(["subscription:override", "platform:manage"])`).
  // The set union below serves as the canonical capability catalogue
  // per admin role; new platform features add themselves to the right
  // bucket here and the route-level gate references the narrow
  // permission.
  "platform:super_admin": ["platform:manage", "platform:audit_read"],
  "platform:support": [
    // T2.1 Phase 2 closure — `platform:manage` safety-net DROPPED.
    // `platform:support` is now strictly read-only across the admin
    // surface. Reads are served via `readOnlyAdminPreHandler`
    // (`platform:audit_read OR platform:manage`) so a support agent
    // can chase any cross-org investigation. Mutations (verify org,
    // change roles, run jobs, replay webhooks, edit feature flags,
    // publish announcements, edit notification config) require a
    // stronger role.
    //
    // Impersonation INTENTIONALLY stays gated to super_admin /
    // platform:super_admin only — this is the platform's most
    // powerful action (full session-level identity assumption) and
    // we follow Stripe / Auth0 / AWS-IAM precedent: only the top
    // tier impersonates. A support agent who needs to debug a user
    // session must escalate to a super-admin colleague rather than
    // receive a permission grant.
    "platform:audit_read",
    "organization:read",
    "event:read",
    "registration:read_all",
    "profile:read_any",
  ],
  "platform:finance": [
    "platform:manage", // migration safety-net
    "platform:audit_read",
    "plan:manage",
    "subscription:override",
    "organization:read",
    "organization:manage_billing",
    "payment:read_all",
    "payment:refund",
    "payment:view_reports",
    "payout:read",
    "payout:create",
  ],
  "platform:ops": [
    "platform:manage", // migration safety-net
    "platform:audit_read",
    "event:read",
    "organization:read",
    "registration:read_all",
    "profile:read_any",
  ],
  "platform:security": [
    // T2.1 Phase 2 closure — `platform:manage` safety-net DROPPED.
    // Security holds full audit read + read-only org / event /
    // profile surfaces to chase forensics. Impersonation stays
    // restricted to super_admin (see comment on platform:support).
    // Route tightening for ops-style mutations (jobs, webhooks,
    // flags) tracked as Phase 2c.
    "platform:audit_read",
    "profile:read_any",
    "organization:read",
    "event:read",
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
  eventId: z.string().nullable(), // for event-scoped roles (co_organizer, staff, speaker, sponsor)
  grantedBy: z.string(), // uid of who granted this role
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

function isAssignmentApplicable(assignment: RoleAssignment, context: PermissionContext): boolean {
  switch (assignment.scope) {
    case "global":
      return true; // Always applies

    case "organization":
      // Applies if the context is within this organization
      return !context.organizationId || assignment.organizationId === context.organizationId;

    case "event":
      // Applies if accessing this specific event
      return !context.eventId || assignment.eventId === context.eventId;

    default:
      return false;
  }
}

/**
 * Check if a set of resolved permissions includes the required permission.
 */
export function hasPermission(permissions: Set<Permission>, required: Permission): boolean {
  if (permissions.has("platform:manage")) return true;
  return permissions.has(required);
}

/**
 * Check if a set of resolved permissions includes ALL of the required permissions.
 */
export function hasAllPermissions(permissions: Set<Permission>, required: Permission[]): boolean {
  if (permissions.has("platform:manage")) return true;
  return required.every((p) => permissions.has(p));
}

/**
 * Check if a set of resolved permissions includes ANY of the required permissions.
 */
export function hasAnyPermission(permissions: Set<Permission>, required: Permission[]): boolean {
  if (permissions.has("platform:manage")) return true;
  return required.some((p) => permissions.has(p));
}
