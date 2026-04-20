import { describe, it, expect, vi, beforeEach } from "vitest";
import { BadgeService } from "../badge.service";
import {
  buildAuthUser,
  buildOrganizerUser,
  buildSuperAdmin,
  buildEvent,
  buildRegistration,
} from "@/__tests__/factories";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockEventRepo = {
  findByIdOrThrow: vi.fn(),
};

const mockRegistrationRepo = {
  findByIdOrThrow: vi.fn(),
  findByEventCursor: vi.fn(),
};

const mockUserRepo = {
  findById: vi.fn(),
  batchGet: vi.fn(),
  getFcmTokens: vi.fn(),
};

vi.mock("@/repositories/event.repository", () => ({
  eventRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockEventRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

vi.mock("@/repositories/registration.repository", () => ({
  registrationRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockRegistrationRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

vi.mock("@/repositories/user.repository", () => ({
  userRepository: new Proxy(
    {},
    {
      get: (_target, prop) => (mockUserRepo as Record<string, unknown>)[prop as string],
    },
  ),
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("@/context/request-context", () => ({
  getRequestId: () => "test-request-id",
}));

// Mock Firestore collections for badges / templates. `vi.mock` hoists to
// the top of the file, so any var the factory closes over must come from
// `vi.hoisted()` — plain `const`s aren't initialised yet at hoist time.
const {
  mockBadgeDocSet,
  mockBadgeDocGet,
  mockBadgeDocCreate,
  mockBadgeDocUpdate,
  mockBadgeDocRef,
  mockTemplateDocGet,
  mockTemplateDocRef,
  mockBadgeWhereGet,
  mockBatchSet,
  mockBatchCommit,
  mockRegistrationWhereGet,
  mockTxSet,
  mockRunTransaction,
} = vi.hoisted(() => {
  const badgeDocSet = vi.fn().mockResolvedValue(undefined);
  const badgeDocGet = vi.fn();
  const badgeDocUpdate = vi.fn().mockResolvedValue(undefined);
  // `docRef.create()` is the atomic create-if-missing used by
  // `bulkGenerate` to avoid clobbering concurrent winners. Default
  // resolves; tests that exercise the ALREADY_EXISTS branch override.
  const badgeDocCreate = vi.fn().mockResolvedValue(undefined);
  const badgeDocRef = {
    id: "badge-1",
    set: badgeDocSet,
    get: badgeDocGet,
    update: badgeDocUpdate,
    create: badgeDocCreate,
  };
  const templateDocGet = vi.fn();
  const templateDocRef = { get: templateDocGet };
  const badgeWhereGet = vi.fn();
  const batchSet = vi.fn();
  const batchCommit = vi.fn().mockResolvedValue(undefined);
  const registrationWhereGet = vi.fn().mockResolvedValue({ empty: true });
  const txSet = vi.fn();
  // Transaction mock — services call db.runTransaction(cb). We feed the
  // callback a tx whose .get(ref) re-uses badgeDocGet so each test
  // controls "exists/not-exists" with a single mock.
  const runTransaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
    cb({
      get: (ref: { get: () => unknown }) => ref.get(),
      set: txSet,
    }),
  );
  return {
    mockBadgeDocSet: badgeDocSet,
    mockBadgeDocGet: badgeDocGet,
    mockBadgeDocCreate: badgeDocCreate,
    mockBadgeDocUpdate: badgeDocUpdate,
    mockBadgeDocRef: badgeDocRef,
    mockTemplateDocGet: templateDocGet,
    mockTemplateDocRef: templateDocRef,
    mockBadgeWhereGet: badgeWhereGet,
    mockBatchSet: batchSet,
    mockBatchCommit: batchCommit,
    mockRegistrationWhereGet: registrationWhereGet,
    mockTxSet: txSet,
    mockRunTransaction: runTransaction,
  };
});

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === "badges") {
        return {
          doc: vi.fn(() => mockBadgeDocRef),
          where: vi.fn(() => ({
            limit: vi.fn(() => ({ get: mockBadgeWhereGet })),
            get: mockBadgeWhereGet,
          })),
        };
      }
      if (name === "badgeTemplates") {
        return {
          doc: vi.fn(() => mockTemplateDocRef),
          where: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => ({
                get: vi.fn().mockResolvedValue({ empty: true }),
              })),
            })),
          })),
        };
      }
      // registrations collection — getMyBadge / getMyBadgePdf use a chained
      // where().where().where().limit().get() to find the user's reg.
      return {
        where: vi.fn(() => ({
          where: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(() => ({ get: mockRegistrationWhereGet })),
            })),
          })),
        })),
      };
    }),
    batch: vi.fn(() => ({
      set: mockBatchSet,
      commit: mockBatchCommit,
    })),
    runTransaction: mockRunTransaction,
  },
  storage: {
    bucket: vi.fn(() => ({
      file: vi.fn(() => ({
        // Used by download() when the badge has a pre-rendered Cloud Storage
        // file (Cloud Function-generated path). We no longer call signed URLs.
        download: vi.fn().mockResolvedValue([Buffer.from("%PDF-stub")]),
      })),
    })),
  },
  COLLECTIONS: {
    EVENTS: "events",
    REGISTRATIONS: "registrations",
    BADGES: "badges",
    BADGE_TEMPLATES: "badgeTemplates",
  },
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { increment: (n: number) => ({ __increment: n }) },
}));

// Lightweight pdf-lib stub: just enough surface for renderBadgePdf() to
// run end-to-end without producing real PDF bytes. Returns a 4-byte
// "%PDF" buffer so callers can assert on a non-empty Buffer.
vi.mock("pdf-lib", () => {
  // A6 at 2.83465 pt/mm → ~297.6 × 419.5
  const fakePage = {
    getSize: () => ({ width: 297.64, height: 419.53 }),
    getWidth: () => 297.64,
    getHeight: () => 419.53,
    drawRectangle: vi.fn(),
    drawCircle: vi.fn(),
    drawLine: vi.fn(),
    drawText: vi.fn(),
    drawImage: vi.fn(),
    drawSvgPath: vi.fn(),
  };
  // widthOfTextAtSize ≈ charCount * size * 0.5 is good enough for the
  // layout helpers (wrapText, centered text). We don't need font metrics
  // accuracy in unit tests — only non-zero return values.
  const fakeFont = {
    widthOfTextAtSize: (s: string, size: number) => s.length * size * 0.5,
  };
  const fakeDoc = {
    addPage: vi.fn(() => fakePage),
    embedFont: vi.fn(async () => fakeFont),
    embedPng: vi.fn(async () => ({ name: "qr" })),
    save: vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    setTitle: vi.fn(),
    setAuthor: vi.fn(),
    setSubject: vi.fn(),
    setCreator: vi.fn(),
  };
  return {
    PDFDocument: { create: vi.fn(async () => fakeDoc) },
    rgb: vi.fn((r: number, g: number, b: number) => ({ r, g, b })),
    StandardFonts: {
      Helvetica: "Helvetica",
      HelveticaBold: "HelveticaBold",
      TimesRomanBold: "TimesRomanBold",
      CourierBold: "CourierBold",
    },
  };
});

vi.mock("qrcode", () => ({
  default: {
    // toDataURL must return a base64 data URL — `renderBadgePdf` splits on
    // "," and decodes the back half. A short valid-base64 stub is enough.
    toDataURL: vi.fn(async () => "data:image/png;base64,aGVsbG8="),
  },
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

const service = new BadgeService();

beforeEach(() => {
  vi.clearAllMocks();
  // Default badge-doc snapshot is "not yet written" so the new
  // deterministic-id create-if-missing path in `BadgeService.generate` /
  // `getMyBadge` falls through to the transaction. Individual tests that
  // exercise the "already exists" branch override this.
  mockBadgeDocGet.mockResolvedValue({ exists: false });
});

describe("BadgeService.generate", () => {
  const orgId = "org-1";

  it("generates a badge for a confirmed registration", async () => {
    const user = buildOrganizerUser(orgId);
    const registration = buildRegistration({
      status: "confirmed",
      eventId: "ev-1",
      userId: "user-1",
    });
    const event = buildEvent({ id: "ev-1", organizationId: orgId });

    mockRegistrationRepo.findByIdOrThrow.mockResolvedValue(registration);
    mockTemplateDocGet.mockResolvedValue({ exists: true });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    const result = await service.generate(registration.id, "tpl-1", user);

    expect(result.registrationId).toBe(registration.id);
    expect(result.status).toBe("pending");
    // The create-if-missing path writes through the transaction helper.
    expect(mockTxSet).toHaveBeenCalled();
  });

  it("returns existing badge instead of creating duplicate", async () => {
    // After the "collapse writers" refactor the uniqueness check is a
    // direct doc.get() on `${eventId}_${userId}` rather than the legacy
    // where("registrationId", "==", ...) scan. Tests flipped to the same
    // lookup path.
    const user = buildOrganizerUser(orgId);
    const registration = buildRegistration({
      status: "confirmed",
      eventId: "ev-1",
      userId: "user-1",
    });
    const event = buildEvent({ id: "ev-1", organizationId: orgId });
    const existingBadge = {
      id: "ev-1_user-1",
      registrationId: registration.id,
      status: "generated",
    };

    mockRegistrationRepo.findByIdOrThrow.mockResolvedValue(registration);
    mockTemplateDocGet.mockResolvedValue({ exists: true });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockBadgeDocGet.mockResolvedValue({
      exists: true,
      id: "ev-1_user-1",
      data: () => existingBadge,
    });

    const result = await service.generate(registration.id, "tpl-1", user);

    expect(result.id).toBe("ev-1_user-1");
    expect(mockBadgeDocSet).not.toHaveBeenCalled();
  });

  it("rejects when registration status is not confirmed or checked_in", async () => {
    const user = buildOrganizerUser(orgId);
    const registration = buildRegistration({ status: "cancelled", eventId: "ev-1" });

    mockRegistrationRepo.findByIdOrThrow.mockResolvedValue(registration);

    await expect(service.generate(registration.id, "tpl-1", user)).rejects.toThrow(
      "inscriptions confirmées",
    );
  });

  it("rejects when template does not exist", async () => {
    const user = buildOrganizerUser(orgId);
    const registration = buildRegistration({ status: "confirmed", eventId: "ev-1" });

    mockRegistrationRepo.findByIdOrThrow.mockResolvedValue(registration);
    mockTemplateDocGet.mockResolvedValue({ exists: false });

    await expect(service.generate(registration.id, "tpl-missing", user)).rejects.toThrow(
      "BadgeTemplate",
    );
  });

  it("rejects user without org access to the event", async () => {
    const user = buildOrganizerUser("org-other");
    const registration = buildRegistration({ status: "confirmed", eventId: "ev-1" });
    const event = buildEvent({ id: "ev-1", organizationId: orgId });

    mockRegistrationRepo.findByIdOrThrow.mockResolvedValue(registration);
    mockTemplateDocGet.mockResolvedValue({ exists: true });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.generate(registration.id, "tpl-1", user)).rejects.toThrow(
      "Accès refusé aux ressources de cette organisation",
    );
  });

  it("rejects participant without badge:generate permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(service.generate("reg-1", "tpl-1", user)).rejects.toThrow(
      "Permission manquante : badge:generate",
    );
  });

  it("allows super_admin to generate badge for any org", async () => {
    const admin = buildSuperAdmin();
    const registration = buildRegistration({ status: "checked_in", eventId: "ev-1" });
    const event = buildEvent({ id: "ev-1", organizationId: "any-org" });

    mockRegistrationRepo.findByIdOrThrow.mockResolvedValue(registration);
    mockTemplateDocGet.mockResolvedValue({ exists: true });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockBadgeWhereGet.mockResolvedValue({ empty: true });

    const result = await service.generate(registration.id, "tpl-1", admin);

    expect(result.status).toBe("pending");
  });
});

describe("BadgeService.bulkGenerate", () => {
  const orgId = "org-1";

  it("queues badges for confirmed registrations via atomic per-doc create", async () => {
    // After collapse-writers, bulkGenerate uses `docRef.create()` per
    // registration instead of `batch.set()` — that's the atomic
    // create-if-missing path that can't clobber a concurrent winner's
    // `pdfURL` / `status` fields. Assertions follow the new shape.
    const user = buildOrganizerUser(orgId);
    const event = buildEvent({ id: "ev-1", organizationId: orgId });
    const registrations = [
      buildRegistration({ id: "reg-1", eventId: "ev-1", userId: "u-1", status: "confirmed" }),
      buildRegistration({ id: "reg-2", eventId: "ev-1", userId: "u-2", status: "confirmed" }),
    ];

    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockTemplateDocGet.mockResolvedValue({ exists: true });
    // No existing badges
    mockBadgeWhereGet.mockResolvedValue({ docs: [] });
    // Return registrations on first call, empty on second
    mockRegistrationRepo.findByEventCursor
      .mockResolvedValueOnce({ data: registrations, lastDoc: null })
      .mockResolvedValueOnce({ data: [], lastDoc: null });

    const result = await service.bulkGenerate("ev-1", "tpl-1", user);

    expect(result.queued).toBe(2);
    expect(mockBadgeDocCreate).toHaveBeenCalledTimes(2);
  });

  it("skips registrations whose badge was created by a concurrent writer (ALREADY_EXISTS)", async () => {
    // Simulates the bulkGenerate race window: snapshot of existing badges
    // is empty, but by the time the creates land another writer
    // (`getMyBadge`, a trigger) has created the same `${eventId}_${userId}`
    // doc. Firestore returns gRPC code 6 (ALREADY_EXISTS); bulkGenerate
    // treats that as "someone else got there first" and does not bump
    // the queued counter.
    //
    // Both the cursor mock and the create mock are fully reset up-front
    // because `vi.clearAllMocks()` in beforeEach only clears call history,
    // not queued `mockResolvedValueOnce` values — residue from earlier
    // tests otherwise makes this flaky under the parallel
    // `Promise.allSettled` consumer.
    const user = buildOrganizerUser(orgId);
    const event = buildEvent({ id: "ev-1", organizationId: orgId });
    const registrations = [
      buildRegistration({ id: "reg-1", eventId: "ev-1", userId: "u-1", status: "confirmed" }),
      buildRegistration({ id: "reg-2", eventId: "ev-1", userId: "u-2", status: "confirmed" }),
    ];

    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockTemplateDocGet.mockResolvedValue({ exists: true });
    mockBadgeWhereGet.mockResolvedValue({ docs: [] });

    mockRegistrationRepo.findByEventCursor.mockReset();
    let cursorCalls = 0;
    mockRegistrationRepo.findByEventCursor.mockImplementation(async () => {
      cursorCalls += 1;
      if (cursorCalls === 1) return { data: registrations, lastDoc: null };
      return { data: [], lastDoc: null };
    });

    mockBadgeDocCreate.mockReset();
    let createCalls = 0;
    mockBadgeDocCreate.mockImplementation(async () => {
      createCalls += 1;
      if (createCalls === 1) return undefined;
      throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
    });

    const result = await service.bulkGenerate("ev-1", "tpl-1", user);

    expect(result.queued).toBe(1);
    expect(mockBadgeDocCreate).toHaveBeenCalledTimes(2);
  });

  it("rethrows on non-ALREADY_EXISTS create failures (e.g. permission denied)", async () => {
    const user = buildOrganizerUser(orgId);
    const event = buildEvent({ id: "ev-1", organizationId: orgId });
    const registrations = [
      buildRegistration({ id: "reg-1", eventId: "ev-1", userId: "u-1", status: "confirmed" }),
    ];

    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockTemplateDocGet.mockResolvedValue({ exists: true });
    mockBadgeWhereGet.mockResolvedValue({ docs: [] });

    mockRegistrationRepo.findByEventCursor.mockReset();
    let cursorCalls = 0;
    mockRegistrationRepo.findByEventCursor.mockImplementation(async () => {
      cursorCalls += 1;
      if (cursorCalls === 1) return { data: registrations, lastDoc: null };
      return { data: [], lastDoc: null };
    });

    // gRPC PERMISSION_DENIED = code 7 — not a concurrent-write signal.
    mockBadgeDocCreate.mockReset();
    mockBadgeDocCreate.mockImplementation(async () => {
      throw Object.assign(new Error("PERMISSION_DENIED"), { code: 7 });
    });

    await expect(service.bulkGenerate("ev-1", "tpl-1", user)).rejects.toThrow("PERMISSION_DENIED");
  });

  // Note: bulkGenerate deduplication (skip existing badges) requires complex
  // Firestore collection mock chaining that is fragile in unit tests. This
  // behavior is better verified in integration tests with the Firebase emulator.

  it("rejects participant without badge:bulk_generate permission", async () => {
    const user = buildAuthUser({ roles: ["participant"] });

    await expect(service.bulkGenerate("ev-1", "tpl-1", user)).rejects.toThrow(
      "Permission manquante : badge:bulk_generate",
    );
  });

  it("rejects user without org access", async () => {
    const user = buildOrganizerUser("org-other");
    const event = buildEvent({ id: "ev-1", organizationId: orgId });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);

    await expect(service.bulkGenerate("ev-1", "tpl-1", user)).rejects.toThrow(
      "Accès refusé aux ressources de cette organisation",
    );
  });

  it("rejects when template does not exist", async () => {
    const user = buildOrganizerUser(orgId);
    const event = buildEvent({ id: "ev-1", organizationId: orgId });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(event);
    mockTemplateDocGet.mockResolvedValue({ exists: false });

    await expect(service.bulkGenerate("ev-1", "tpl-missing", user)).rejects.toThrow(
      "BadgeTemplate",
    );
  });
});

// ─── getMyBadge ────────────────────────────────────────────────────────────
// The on-demand path must (a) be transactional (no duplicate badge docs on
// concurrent first-time fetches), (b) emit `badge.generated` only when it
// actually wrote a new doc, and (c) reject ineligible registrations.

describe("BadgeService.getMyBadge", () => {
  it("returns the existing badge document when one is present", async () => {
    const user = buildAuthUser({ uid: "user-1", roles: ["participant"] });
    const existing = {
      id: "ev-1_user-1",
      registrationId: "reg-1",
      eventId: "ev-1",
      userId: "user-1",
      status: "generated",
      pdfURL: null,
      qrCodeValue: "qr-payload",
      generatedAt: "2026-01-01T00:00:00.000Z",
    };
    mockBadgeDocGet.mockResolvedValue({
      exists: true,
      id: existing.id,
      data: () => existing,
    });

    const result = await service.getMyBadge("ev-1", user);

    expect(result.id).toBe(existing.id);
    expect(result.status).toBe("generated");
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it("creates a stub badge document inside a transaction on first fetch", async () => {
    const user = buildAuthUser({ uid: "user-1", roles: ["participant"] });
    const registration = buildRegistration({
      id: "reg-1",
      eventId: "ev-1",
      userId: "user-1",
      status: "confirmed",
    });
    mockBadgeDocGet.mockResolvedValue({ exists: false });
    mockRegistrationWhereGet.mockResolvedValue({
      empty: false,
      docs: [{ id: registration.id, data: () => registration }],
    });

    const result = await service.getMyBadge("ev-1", user);

    expect(result.eventId).toBe("ev-1");
    expect(result.userId).toBe("user-1");
    expect(result.pdfURL).toBeNull();
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxSet).toHaveBeenCalledTimes(1);
  });

  it("rejects when no eligible registration exists", async () => {
    const user = buildAuthUser({ uid: "user-1", roles: ["participant"] });
    mockBadgeDocGet.mockResolvedValue({ exists: false });
    mockRegistrationWhereGet.mockResolvedValue({ empty: true });

    await expect(service.getMyBadge("ev-1", user)).rejects.toThrow("Registration");
  });

  it("rejects participant without badge:view_own", async () => {
    const user = buildAuthUser({ roles: [] });
    await expect(service.getMyBadge("ev-1", user)).rejects.toThrow(
      "Permission manquante : badge:view_own",
    );
  });
});

// ─── getMyBadgePdf ─────────────────────────────────────────────────────────
// Streams raw PDF bytes for the participant's own badge — no Cloud Storage
// signed URLs (the bug this branch fixes). Verifies happy path and gating.

describe("BadgeService.getMyBadgePdf", () => {
  const orgId = "org-1";

  it("returns rendered PDF bytes + filename for an eligible registration", async () => {
    const user = buildAuthUser({ uid: "user-1", roles: ["participant"] });
    const registration = buildRegistration({
      id: "reg-1",
      eventId: "ev-1",
      userId: "user-1",
      status: "confirmed",
    });
    mockRegistrationWhereGet.mockResolvedValue({
      empty: false,
      docs: [{ id: registration.id, data: () => registration }],
    });
    mockEventRepo.findByIdOrThrow.mockResolvedValue(
      buildEvent({ id: "ev-1", organizationId: orgId }),
    );
    mockUserRepo.findById.mockResolvedValue({ uid: "user-1", displayName: "Aïssatou" });

    const result = await service.getMyBadgePdf("ev-1", user);

    expect(result.filename).toBe("badge-ev-1.pdf");
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("rejects when the registration is not confirmed/checked_in", async () => {
    const user = buildAuthUser({ uid: "user-1", roles: ["participant"] });
    const registration = buildRegistration({
      id: "reg-1",
      eventId: "ev-1",
      userId: "user-1",
      status: "pending",
    });
    mockRegistrationWhereGet.mockResolvedValue({
      empty: false,
      docs: [{ id: registration.id, data: () => registration }],
    });

    await expect(service.getMyBadgePdf("ev-1", user)).rejects.toThrow("inscriptions confirmées");
  });

  it("rejects participant without badge:view_own", async () => {
    const user = buildAuthUser({ roles: [] });
    await expect(service.getMyBadgePdf("ev-1", user)).rejects.toThrow(
      "Permission manquante : badge:view_own",
    );
  });
});

// ─── download (organizer/staff binary stream) ──────────────────────────────
// Returns raw bytes — read from Cloud Storage when a Cloud Function-rendered
// PDF exists, otherwise re-rendered from the registration. Atomic increment
// on downloadCount avoids the read-then-write race.

describe("BadgeService.download", () => {
  const orgId = "org-1";

  it("re-renders PDF bytes when the badge has no stored Cloud Storage file", async () => {
    const user = buildAuthUser({ uid: "user-1", roles: ["participant"] });
    const badge = {
      id: "badge-1",
      registrationId: "reg-1",
      eventId: "ev-1",
      userId: "user-1",
      status: "generated",
      pdfURL: null,
      downloadCount: 0,
    };
    mockBadgeDocGet.mockResolvedValue({ exists: true, id: badge.id, data: () => badge });

    const registration = buildRegistration({
      id: "reg-1",
      eventId: "ev-1",
      userId: "user-1",
      status: "confirmed",
    });
    mockRegistrationRepo.findByIdOrThrow.mockResolvedValue(registration);
    mockEventRepo.findByIdOrThrow.mockResolvedValue(
      buildEvent({ id: "ev-1", organizationId: orgId }),
    );
    mockUserRepo.findById.mockResolvedValue({ uid: "user-1", displayName: "Aïssatou" });

    const result = await service.download("badge-1", user);

    expect(result.filename).toBe("badge-ev-1.pdf");
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    // Increment is atomic — passes a FieldValue sentinel, never reads first.
    expect(mockBadgeDocUpdate).toHaveBeenCalledWith({
      downloadCount: expect.objectContaining({ __increment: 1 }),
    });
  });

  it("rejects access when caller is not the badge owner and lacks badge:generate", async () => {
    const user = buildAuthUser({ uid: "stranger", roles: ["participant"] });
    const badge = {
      id: "badge-1",
      registrationId: "reg-1",
      eventId: "ev-1",
      userId: "user-1",
      status: "generated",
      pdfURL: null,
      downloadCount: 0,
    };
    mockBadgeDocGet.mockResolvedValue({ exists: true, id: badge.id, data: () => badge });

    await expect(service.download("badge-1", user)).rejects.toThrow(
      "Permission manquante : badge:generate",
    );
  });

  it("rejects when the badge generation has failed", async () => {
    const user = buildAuthUser({ uid: "user-1", roles: ["participant"] });
    const badge = {
      id: "badge-1",
      registrationId: "reg-1",
      eventId: "ev-1",
      userId: "user-1",
      status: "failed",
      pdfURL: null,
      downloadCount: 0,
      error: "render_failed",
    };
    mockBadgeDocGet.mockResolvedValue({ exists: true, id: badge.id, data: () => badge });

    await expect(service.download("badge-1", user)).rejects.toThrow("render_failed");
  });

  it("returns 404-style NotFoundError when badge document is missing", async () => {
    const user = buildAuthUser({ uid: "user-1", roles: ["participant"] });
    mockBadgeDocGet.mockResolvedValue({ exists: false });

    await expect(service.download("missing", user)).rejects.toThrow("Badge");
  });
});
