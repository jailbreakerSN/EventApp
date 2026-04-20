import { describe, it, expect, vi, beforeAll } from "vitest";
import Fastify from "fastify";

// ─── Route inventory snapshot ──────────────────────────────────────────────
// Boots a lightweight Fastify app, installs the same `registerRoutes`
// chain the production server uses, captures every route via the
// `onRoute` hook, and snapshots `METHOD path [auth invariants]`.
//
// Fails when:
//   - a route is accidentally removed / renamed
//   - a mutating route loses `authenticate` or `requirePermission(...)`
//   - a public read sneaks in without `optionalAuth` bypass
//   - the webhook exception list grows (new un-authenticated POST)
//
// Why no global plugins? The production app.ts registers helmet, CORS,
// rate-limit, swagger, and the error handler. None of that changes the
// route table itself — `onRoute` fires during `.register()` walk
// regardless of cross-cutting middleware. Skipping them keeps the test
// self-contained (no rate-limit state, no Firebase boot) and fast.

// Firebase dependencies referenced by route-plugin modules at import time
// (typed services pull in `@/config/firebase`). Stub to avoid a real
// Firestore connection just to introspect the route tree.
// Fake Firestore surface — just enough for repository constructors that
// call `db.collection(name)` at import time. None of these stubs are
// actually invoked at request time by the inventory test — we never
// fire a real request, we only walk the route table via `onRoute`.
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

// ─── Types ──────────────────────────────────────────────────────────────────

interface RouteRow {
  method: string;
  path: string;
  /** `true` (always), `"optional"` (public read), `false` (webhook / health). */
  auth: boolean | "optional";
  emailVerified: boolean;
  /** `requirePermission("resource:action")` arguments, in registration order. */
  permissions: string[];
  /** Free-form flags — bubble up `requireAnyPermission` / `requireAllPermissions`. */
  flags: string[];
}

// ─── Middleware fingerprinting ─────────────────────────────────────────────
// `preHandler` entries are functions. We look for each middleware by the
// `name` property Node assigns to named function exports. If `requirePermission`
// is implemented as a factory that returns an anonymous function, the
// argument is typically captured in the returned function's `.permission`
// marker (see apps/api/src/middlewares/permission.middleware.ts). We fall
// back to parsing the toString() output when the marker isn't exposed.

function introspect(
  preHandlers: unknown,
): Pick<RouteRow, "auth" | "emailVerified" | "permissions" | "flags"> {
  const list = Array.isArray(preHandlers) ? preHandlers : preHandlers ? [preHandlers] : [];
  const fns = list.filter(
    (h): h is { name?: string; toString?: () => string } => typeof h === "function",
  );

  let auth: RouteRow["auth"] = false;
  let emailVerified = false;
  const permissions: string[] = [];
  const flags: string[] = [];

  for (const fn of fns) {
    const name = fn.name ?? "";
    const src = fn.toString?.() ?? "";

    if (name === "authenticate" || src.includes("verifyIdToken")) {
      auth = true;
    } else if (name === "optionalAuth" || src.includes("optionalAuth")) {
      auth = "optional";
    } else if (name === "requireEmailVerified" || src.includes("EMAIL_NOT_VERIFIED")) {
      emailVerified = true;
    }

    // requirePermission / requireAll / requireAny attach their arguments
    // as non-enumerable markers on the returned handler — see
    // apps/api/src/middlewares/permission.middleware.ts. Reading those
    // lets us record the exact gate without parsing closures.
    const markerPerm = (fn as { __permission?: string }).__permission;
    if (markerPerm) permissions.push(markerPerm);

    const markerAny = (fn as { __permissionsAny?: string[] }).__permissionsAny;
    if (markerAny) flags.push(`any(${[...markerAny].sort().join(",")})`);

    const markerAll = (fn as { __permissionsAll?: string[] }).__permissionsAll;
    if (markerAll) flags.push(`all(${[...markerAll].sort().join(",")})`);
  }

  return { auth, emailVerified, permissions, flags };
}

// ─── Boot ───────────────────────────────────────────────────────────────────

const captured: RouteRow[] = [];

beforeAll(async () => {
  // Dynamic import so the `vi.mock` calls above are in effect before
  // route modules pull in `@/config/firebase` at import time.
  const { registerRoutes } = await import("@/routes/index");

  const app = Fastify({ logger: false });
  app.addHook("onRoute", (opts) => {
    const { method, url, preHandler } = opts;
    const methods = Array.isArray(method) ? method : [method];
    for (const m of methods) {
      if (m === "HEAD") continue; // Fastify auto-registers HEAD for GET
      captured.push({
        method: m,
        path: url,
        ...introspect(preHandler),
      });
    }
  });

  await registerRoutes(app);
  await app.ready();
  // sort for stable snapshots regardless of plugin-registration order
  captured.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  await app.close();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("route inventory", () => {
  it("captured at least 100 routes (sanity)", () => {
    // The production app registers ~150 routes. A sudden drop means a
    // whole plugin stopped registering — usually an import error that
    // slipped past typecheck because the failing line is runtime-only.
    expect(captured.length).toBeGreaterThan(100);
  });

  it("matches the snapshot", () => {
    // Snapshot as TSV-ish text for readable PR diffs.
    const lines = captured.map((r) => {
      const authStr = r.auth === true ? "auth" : r.auth === "optional" ? "optional" : "none";
      const email = r.emailVerified ? " emailVerified" : "";
      const perms = r.permissions.length ? ` perms=[${r.permissions.join(",")}]` : "";
      const flags = r.flags.length ? ` flags=[${r.flags.join(",")}]` : "";
      return `${r.method} ${r.path} ${authStr}${email}${perms}${flags}`;
    });
    expect(lines.join("\n")).toMatchSnapshot();
  });

  describe("invariants", () => {
    // Documented exception list — every un-authenticated mutation below
    // MUST stay in this list. Adding a new webhook means updating this
    // test deliberately; accidental additions fail loud.
    const UNAUTHENTICATED_MUTATIONS_ALLOWED = new Set<string>([
      "POST /v1/payments/webhook/:provider",
      "POST /v1/payments/webhook", // legacy dev-only mock
      "POST /v1/payments/mock-checkout/:txId/complete", // dev-only mock provider flow
      "POST /v1/events/:eventId/promo-codes/validate", // documented public validator
      "POST /v1/newsletter/subscribe",
      "POST /v1/newsletter/unsubscribe",
    ]);

    it("every mutating route authenticates (except the documented webhook list)", () => {
      const mutating = captured.filter((r) =>
        ["POST", "PATCH", "PUT", "DELETE"].includes(r.method),
      );
      const violators: string[] = [];
      for (const r of mutating) {
        if (r.auth === true) continue;
        const key = `${r.method} ${r.path}`;
        if (UNAUTHENTICATED_MUTATIONS_ALLOWED.has(key)) continue;
        violators.push(key);
      }
      expect(violators).toEqual([]);
    });

    it("every authenticated mutating route declares a permission or a documented exemption", () => {
      // Some mutating routes (e.g. `POST /v1/notifications/:id/read`,
      // account self-service endpoints) are gated by ownership rather
      // than a named permission — the service checks `request.user.uid`
      // against the resource. Those need to be whitelisted explicitly.
      const OWNERSHIP_GATED = new Set<string>([
        "PATCH /v1/users/me",
        "POST /v1/users/me/fcm-tokens",
        "POST /v1/users/me/fcm-token", // singular legacy alias
        "DELETE /v1/users/me/fcm-tokens/:token",
        "POST /v1/notifications/:id/read",
        "POST /v1/notifications/read-all",
        "POST /v1/notifications/subscribe",
        "POST /v1/notifications/unsubscribe",
        "PATCH /v1/notifications/preferences",
        // Invite accept/decline: authed user owns the invite token they
        // provide in the body. `POST /v1/invites/:token/...` is the
        // participant-side variant and `/accept` / `/decline` (no token
        // in path) is the dashboard variant.
        "POST /v1/invites/:token/accept",
        "POST /v1/invites/:token/decline",
        "POST /v1/invites/accept",
        "POST /v1/invites/decline",
        // Session bookmark: per-user save-for-later on an event session.
        "POST /v1/events/:eventId/sessions/:sessionId/bookmark",
        "DELETE /v1/events/:eventId/sessions/:sessionId/bookmark",
        // Registration self-service.
        "POST /v1/registrations",
        "PATCH /v1/registrations/:registrationId",
        // Messaging: owns own conversations.
        "POST /v1/conversations",
        "DELETE /v1/conversations/:id",
        "POST /v1/conversations/:id/messages",
        "PATCH /v1/conversations/:id/read",
      ]);
      const violators: string[] = [];
      for (const r of captured) {
        if (!["POST", "PATCH", "PUT", "DELETE"].includes(r.method)) continue;
        if (r.auth !== true) continue; // already covered by previous test
        if (r.permissions.length > 0) continue;
        if (r.flags.length > 0) continue;
        const key = `${r.method} ${r.path}`;
        if (OWNERSHIP_GATED.has(key)) continue;
        violators.push(key);
      }
      expect(violators).toEqual([]);
    });
  });
});
