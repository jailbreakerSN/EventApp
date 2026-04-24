import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildAuthUser } from "@/__tests__/factories";

/**
 * T2.4 — AnnouncementsService unit tests.
 *
 * The service issues two parallel Firestore queries, each with a
 * `.where("audience", "==", X)` clause. We mock the query-builder
 * chain to track the audience passed on each path and return the
 * corresponding snapshot. Done via a query-builder factory so we
 * capture the audience LATE (when `.get()` is called), not when
 * `.where()` is first chained — this way concurrent query chains
 * can't leak state through shared state.
 */

const hoisted = vi.hoisted(() => ({
  snapByAudience: new Map<string, { docs: Array<{ id: string; data: () => unknown }> }>(),
}));

function emptySnap() {
  return { docs: [] };
}

function setSnap(audience: string, docs: Array<{ id: string; data: () => unknown }>) {
  hoisted.snapByAudience.set(audience, { docs });
}

vi.mock("@/config/firebase", () => {
  function makeQueryBuilder(audienceFilter: string | null) {
    return {
      where: (field: string, _op: string, value: unknown) => {
        // The service chains `.where("active", ...)` first then
        // `.where("audience", ...)`. The audience value is what
        // steers which snapshot we return.
        if (field === "audience" && typeof value === "string") {
          return makeQueryBuilder(value);
        }
        return makeQueryBuilder(audienceFilter);
      },
      orderBy: () => ({
        limit: () => ({
          get: async () => {
            if (!audienceFilter) return emptySnap();
            return hoisted.snapByAudience.get(audienceFilter) ?? emptySnap();
          },
        }),
      }),
    };
  }

  return {
    db: {
      collection: vi.fn(() => makeQueryBuilder(null)),
    },
    COLLECTIONS: { ANNOUNCEMENTS: "announcements" },
  };
});

import { announcementsService } from "../announcements.service";

function doc(
  id: string,
  data: {
    title?: string;
    body?: string;
    severity?: "info" | "warning" | "critical";
    audience?: "all" | "organizers" | "participants";
    publishedAt?: string;
    expiresAt?: string;
    active?: boolean;
    createdBy?: string;
  },
): { id: string; data: () => unknown } {
  return {
    id,
    data: () => ({
      title: "Title",
      body: "Body",
      severity: "info",
      audience: "all",
      publishedAt: "2026-04-20T00:00:00.000Z",
      active: true,
      createdBy: "admin-secret",
      ...data,
    }),
  };
}

beforeEach(() => {
  hoisted.snapByAudience.clear();
});

// ─── Audience routing ─────────────────────────────────────────────────────

describe("announcementsService.listActiveForUser — audience routing", () => {
  it("returns organizer-targeted rows to an organizer", async () => {
    setSnap("all", [doc("a1", { audience: "all", title: "Everyone" })]);
    setSnap("organizers", [doc("o1", { audience: "organizers", title: "Orgs only" })]);
    setSnap("participants", [doc("p1", { audience: "participants", title: "NOT for organizer" })]);

    const user = buildAuthUser({ roles: ["organizer"] });
    const result = await announcementsService.listActiveForUser(user);

    const titles = result.map((r) => r.title);
    expect(titles).toContain("Everyone");
    expect(titles).toContain("Orgs only");
    expect(titles).not.toContain("NOT for organizer");
  });

  it("returns participant-targeted rows to a participant", async () => {
    setSnap("all", [doc("a1", { audience: "all", title: "Everyone" })]);
    setSnap("participants", [doc("p1", { audience: "participants", title: "Participants only" })]);
    setSnap("organizers", [doc("o1", { audience: "organizers", title: "NOT for participant" })]);

    const user = buildAuthUser({ roles: ["participant"] });
    const result = await announcementsService.listActiveForUser(user);

    const titles = result.map((r) => r.title);
    expect(titles).toContain("Everyone");
    expect(titles).toContain("Participants only");
    expect(titles).not.toContain("NOT for participant");
  });
});

// ─── Security: createdBy must not leak ────────────────────────────────────

describe("announcementsService.listActiveForUser — security", () => {
  it("strips createdBy from the public response shape", async () => {
    setSnap("all", [
      doc("a1", { audience: "all", title: "Maintenance", createdBy: "admin-uid-secret" }),
    ]);
    const user = buildAuthUser({ roles: ["organizer"] });
    const [only] = await announcementsService.listActiveForUser(user);
    expect(only).toBeDefined();
    expect("createdBy" in only!).toBe(false);
  });
});

// ─── Expiry filter ─────────────────────────────────────────────────────────

describe("announcementsService.listActiveForUser — expiry", () => {
  it("drops rows whose expiresAt is in the past", async () => {
    const pastIso = new Date(Date.now() - 1000).toISOString();
    setSnap("all", [
      doc("a1", { audience: "all", title: "Expired", expiresAt: pastIso }),
      doc("a2", { audience: "all", title: "Live" }),
    ]);
    const user = buildAuthUser({ roles: ["organizer"] });
    const result = await announcementsService.listActiveForUser(user);
    const titles = result.map((r) => r.title);
    expect(titles).not.toContain("Expired");
    expect(titles).toContain("Live");
  });

  it("keeps rows with no expiresAt at all", async () => {
    setSnap("all", [doc("a1", { audience: "all", title: "Evergreen" })]);
    const user = buildAuthUser({ roles: ["organizer"] });
    const result = await announcementsService.listActiveForUser(user);
    expect(result.map((r) => r.title)).toContain("Evergreen");
  });
});

// ─── Dedup + sort ─────────────────────────────────────────────────────────

describe("announcementsService.listActiveForUser — ordering", () => {
  it("returns newest first across merged audience queries", async () => {
    setSnap("all", [
      doc("a1", { audience: "all", title: "Old", publishedAt: "2026-04-01T00:00:00.000Z" }),
    ]);
    setSnap("organizers", [
      doc("o1", {
        audience: "organizers",
        title: "New",
        publishedAt: "2026-04-20T00:00:00.000Z",
      }),
    ]);
    const user = buildAuthUser({ roles: ["organizer"] });
    const result = await announcementsService.listActiveForUser(user);
    expect(result[0]?.title).toBe("New");
    expect(result[1]?.title).toBe("Old");
  });
});
