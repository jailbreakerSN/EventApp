import { describe, it, expect, vi, beforeAll } from "vitest";
import Fastify from "fastify";
import {
  type SystemRole,
  type Permission,
  resolvePermissions,
  hasPermission,
} from "@teranga/shared-types";

// ─── Permission matrix (pure model × API route table) ──────────────────────
// For every route the production API exposes with a `__permission` marker,
// cross-check each system role: does the shared-types permission model
// predict the same allow/deny that the API's middleware would enforce?
//
// This catches the "added a new permission to the API but forgot to grant
// it to the organizer role" class of regression — silent until someone
// complains they can't click the button. The test runs in pure JS
// (resolvePermissions is a plain function) so no Fastify boot is needed
// beyond the shared inventory capture below.
//
// The inventory capture here mirrors the pattern in
// `route-inventory.test.ts` — boot Fastify, collect every route via the
// onRoute hook, read the `__permission` marker attached by
// `requirePermission(...)`. We intentionally duplicate the boot rather
// than sharing state across test files because vitest isolates test
// files by default and cross-file imports would add global order
// dependencies.

// Fake Firestore surface — see route-inventory.test.ts for rationale.
const fakeCollection = () => ({
  doc: () => ({ get: async () => ({ exists: false }) }),
  where: () => fakeCollection(),
  orderBy: () => fakeCollection(),
  limit: () => fakeCollection(),
  get: async () => ({ docs: [], size: 0, empty: true }),
  add: async () => ({ id: "stub" }),
});
vi.mock("@/config/firebase", () => ({
  db: {
    collection: () => fakeCollection(),
    listCollections: async () => [],
    runTransaction: async (fn: (tx: unknown) => unknown) => fn({}),
    batch: () => ({ commit: async () => undefined }),
  },
  auth: {},
  storage: {},
  COLLECTIONS: new Proxy(
    {},
    {
      get: (_t, prop: string) => prop,
    },
  ),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => "__SERVER_TS__",
    increment: (n: number) => ({ __increment: n }),
    arrayUnion: (...xs: unknown[]) => ({ __arrayUnion: xs }),
    arrayRemove: (...xs: unknown[]) => ({ __arrayRemove: xs }),
    delete: () => "__DELETE__",
  },
  Timestamp: { now: () => ({ seconds: 0, nanoseconds: 0 }) },
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async () => ({ uid: "test", email: "t@test", email_verified: true }),
    createCustomToken: async () => "token",
  }),
}));

vi.mock("firebase-admin/storage", () => ({
  getStorage: () => ({ bucket: () => ({ file: () => ({}) }) }),
}));

interface GatedRoute {
  method: string;
  path: string;
  permission: Permission;
}

const gatedRoutes: GatedRoute[] = [];

// Every system role in lockstep with `SystemRoleSchema`. Order doesn't
// matter — the matrix is cross-product anyway.
const ROLES: SystemRole[] = [
  "participant",
  "organizer",
  "co_organizer",
  "speaker",
  "sponsor",
  "staff",
  "venue_manager",
  "super_admin",
];

beforeAll(async () => {
  const { registerRoutes } = await import("@/routes/index");
  const app = Fastify({ logger: false });

  app.addHook("onRoute", (opts) => {
    const { method, url, preHandler } = opts;
    const methods = Array.isArray(method) ? method : [method];
    const handlers = Array.isArray(preHandler) ? preHandler : preHandler ? [preHandler] : [];
    const permissions: Permission[] = [];
    for (const h of handlers) {
      if (typeof h !== "function") continue;
      const marker = (h as { __permission?: Permission }).__permission;
      if (marker) permissions.push(marker);
    }
    if (permissions.length === 0) return;
    for (const m of methods) {
      if (m === "HEAD") continue;
      for (const permission of permissions) {
        gatedRoutes.push({ method: m, path: url, permission });
      }
    }
  });

  await registerRoutes(app);
  await app.ready();
  await app.close();
}, 30_000);

// ─── Pre-computed role permission sets ─────────────────────────────────────
// `resolvePermissions` takes role assignments rather than bare roles — the
// function expects to walk the RoleAssignment[] shape the auth middleware
// builds at request time. We reproduce the same shape here so the matrix
// test and the request pipeline compute identical sets.
function resolveFor(role: SystemRole): Set<Permission> {
  return resolvePermissions(
    [
      {
        id: `test-${role}`,
        userId: "test",
        role,
        scope: role === "super_admin" || role === "participant" ? "global" : "organization",
        organizationId: role === "super_admin" || role === "participant" ? null : "org-1",
        eventId: null,
        grantedBy: "system",
        grantedAt: new Date().toISOString(),
        isActive: true,
      },
    ],
    {
      // Treat the permission check as if the request targets the user's
      // own organization. Cross-org denial is covered by service-layer
      // `requireOrganizationAccess()` not by the permission model.
      organizationId: role === "super_admin" || role === "participant" ? undefined : "org-1",
    },
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("permission matrix (API routes × shared-types model)", () => {
  it("captured at least 50 gated routes (sanity)", () => {
    // The production API has ~100 gated routes. A sudden drop is a
    // registration import failure — usually caught by the inventory
    // test too, but this is a cheap second floor.
    expect(gatedRoutes.length).toBeGreaterThan(50);
  });

  it("every route's permission exists in the shared-types Permission union", () => {
    // If this fails, someone passed an unknown string to
    // `requirePermission(...)` — TypeScript would have caught it unless
    // an `as Permission` cast was used. Either way, fail loud.
    const sets = ROLES.map((r) => [r, resolveFor(r)] as const);
    const allKnown = new Set<string>();
    for (const [, set] of sets) {
      for (const p of set) allKnown.add(p);
    }
    // A permission is "known" if at least one role can do it OR if it's
    // present in the super_admin superset. super_admin resolves to all
    // permissions via the `platform:manage` expansion, so the set it
    // produces is the authoritative universe.
    const universe = sets.find(([r]) => r === "super_admin")![1];
    const unknown = [...new Set(gatedRoutes.map((r) => r.permission))].filter(
      (p) => !universe.has(p),
    );
    expect(unknown).toEqual([]);
  });

  it("super_admin can reach every gated route", () => {
    const superPerms = resolveFor("super_admin");
    const denied = gatedRoutes.filter((r) => !hasPermission(superPerms, r.permission));
    expect(denied).toEqual([]);
  });

  it("participant is denied every organizer-tier mutation", () => {
    const participantPerms = resolveFor("participant");
    // Only check non-GET routes — participants can legitimately GET
    // a lot of things. The invariant: no POST/PATCH/DELETE routes with
    // an organizer permission should resolve for a participant.
    const organizerOnly = gatedRoutes.filter(
      (r) =>
        r.method !== "GET" &&
        !r.permission.startsWith("registration:") &&
        !r.permission.startsWith("profile:") &&
        !r.permission.startsWith("feed:") &&
        !r.permission.startsWith("messaging:") &&
        !r.permission.startsWith("payment:") &&
        !r.permission.startsWith("notification:") &&
        // badges + receipts: participants can touch their own
        r.permission !== "badge:view_own" &&
        r.permission !== "payment:read_own",
    );
    const leaked = organizerOnly.filter((r) => hasPermission(participantPerms, r.permission));
    expect(leaked).toEqual([]);
  });

  // Matrix assertion: every (role, route) tuple produces a boolean. We
  // don't hand-maintain a giant table of expected booleans — instead we
  // assert that `hasPermission(resolveFor(role), route.permission)` is
  // internally consistent per role (no contradictions, no duplicates)
  // and snapshot the shape so any ROLE_PERMISSIONS change surfaces as
  // a reviewable diff.
  it("role × permission access matrix matches the shared model (snapshot)", () => {
    // De-duplicate on `${method} ${path} ${permission}` for a stable
    // snapshot regardless of register-order noise.
    const uniqueRoutes = [
      ...new Map(gatedRoutes.map((r) => [`${r.method} ${r.path} ${r.permission}`, r])).values(),
    ].sort(
      (a, b) =>
        a.path.localeCompare(b.path) ||
        a.method.localeCompare(b.method) ||
        a.permission.localeCompare(b.permission),
    );

    // Per-route line: `METHOD path permission allowedRoles=[...]` — the
    // set of roles that can access that route, sorted for stability.
    const lines = uniqueRoutes.map((r) => {
      const allowed = ROLES.filter((role) => hasPermission(resolveFor(role), r.permission)).sort();
      return `${r.method} ${r.path} perm=${r.permission} allow=[${allowed.join(",")}]`;
    });
    expect(lines.join("\n")).toMatchSnapshot();
  });
});
