import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenError } from "@/errors/app-error";
import { buildAuthUser, buildOrganizerUser } from "@/__tests__/factories";
import type { ParticipantProfile } from "@teranga/shared-types";

// ─── Participant profile service — tags + notes contract ──────────────────
//
// Phase O7. Tests pin: idempotent no-op, tag dedupe + sort, notes
// scrubbed from event payload, permission denial, cross-org rejection.

const hoisted = vi.hoisted(() => ({
  storedDoc: null as { exists: boolean; data: () => unknown } | null,
  setMock: vi.fn(),
  emitMock: vi.fn(),
  getAllMock: vi.fn(),
}));

const setMock = hoisted.setMock;
const emitMock = hoisted.emitMock;
function setStoredDoc(value: typeof hoisted.storedDoc): void {
  hoisted.storedDoc = value;
}

vi.mock("@/config/firebase", () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: async () => hoisted.storedDoc ?? { exists: false, data: () => undefined },
        set: hoisted.setMock,
      })),
    })),
    getAll: (...refs: unknown[]) => hoisted.getAllMock(...refs),
  },
  COLLECTIONS: {
    PARTICIPANT_PROFILES: "participantProfiles",
    REGISTRATIONS: "registrations",
  },
}));

vi.mock("@/events/event-bus", () => ({
  eventBus: {
    emit: hoisted.emitMock,
  },
}));

vi.mock("@/context/request-context", () => ({
  getRequestContext: () => ({ requestId: "test-request-id" }),
  getRequestId: () => "test-request-id",
  trackFirestoreReads: vi.fn(),
}));

import {
  participantProfileService,
  dedupeAndSortTags,
  applyTagDelta,
} from "../participant-profile.service";

beforeEach(() => {
  vi.clearAllMocks();
  setStoredDoc(null);
});

// ─── Pure helpers ────────────────────────────────────────────────────────

describe("dedupeAndSortTags", () => {
  it("deduplicates case-sensitively and sorts alphabetically (FR locale)", () => {
    expect(dedupeAndSortTags(["VIP", "Press", "VIP", "Speaker"])).toEqual([
      "Press",
      "Speaker",
      "VIP",
    ]);
  });

  it("trims whitespace and drops empty tags", () => {
    expect(dedupeAndSortTags(["  VIP  ", "", "Press"])).toEqual(["Press", "VIP"]);
  });

  it("preserves accented characters in the sort comparator", () => {
    const result = dedupeAndSortTags(["Élite", "Bénévole", "Anonyme"]);
    expect(result[0]).toBe("Anonyme");
    expect(result).toContain("Bénévole");
    expect(result).toContain("Élite");
  });
});

describe("applyTagDelta", () => {
  it("adds new tags and removes the requested ones", () => {
    expect(applyTagDelta(["VIP", "Press"], new Set(["Speaker"]), new Set(["VIP"]))).toEqual([
      "Press",
      "Speaker",
    ]);
  });

  it("is a no-op when the delta sets are empty", () => {
    const out = applyTagDelta(["VIP", "Press"], new Set(), new Set());
    expect(out).toEqual(["Press", "VIP"]);
  });

  it("removes wins over add when the same tag is in both deltas", () => {
    expect(applyTagDelta([], new Set(["X"]), new Set(["X"]))).toEqual([]);
  });
});

// ─── Service contract ────────────────────────────────────────────────────

describe("participantProfileService.update — happy path + idempotency", () => {
  it("creates a fresh profile on first call and emits the event", async () => {
    const user = buildOrganizerUser("org-1");

    const result = await participantProfileService.update(user, "org-1", "u-99", {
      tags: ["VIP"],
      notes: "Sponsor potentiel",
    });

    expect(result.organizationId).toBe("org-1");
    expect(result.userId).toBe("u-99");
    expect(result.tags).toEqual(["VIP"]);
    expect(result.notes).toBe("Sponsor potentiel");
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith(
      "participant_profile.updated",
      expect.objectContaining({
        organizationId: "org-1",
        userId: "u-99",
        tags: ["VIP"],
        notesChanged: true,
      }),
    );
  });

  it("scrubs the notes value from the emitted event (privacy)", async () => {
    const user = buildOrganizerUser("org-1");
    await participantProfileService.update(user, "org-1", "u-99", {
      notes: "Secret note about the participant",
    });

    const payload = emitMock.mock.calls[0][1] as { notesChanged: boolean; tags: string[] };
    // Only `notesChanged: true` travels — the value itself NEVER lands
    // in the audit log payload.
    expect(payload.notesChanged).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("Secret note");
  });

  it("is idempotent when the dto matches the existing doc", async () => {
    setStoredDoc({
      exists: true,
      data: () =>
        ({
          id: "org-1_u-99",
          organizationId: "org-1",
          userId: "u-99",
          tags: ["VIP"],
          notes: "Sponsor",
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        }) satisfies ParticipantProfile,
    });
    const user = buildOrganizerUser("org-1");

    await participantProfileService.update(user, "org-1", "u-99", { tags: ["VIP"] });
    expect(setMock).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("dedupes + sorts the supplied tags before persisting", async () => {
    const user = buildOrganizerUser("org-1");
    const result = await participantProfileService.update(user, "org-1", "u-99", {
      tags: ["VIP", "VIP", "Press", "  "],
    });
    expect(result.tags).toEqual(["Press", "VIP"]);
  });
});

describe("participantProfileService.update — auth", () => {
  it("rejects callers without registration:read_all", async () => {
    const participant = buildAuthUser({ roles: ["participant"], organizationId: "org-1" });
    await expect(
      participantProfileService.update(participant, "org-1", "u-99", { tags: ["X"] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects cross-org callers", async () => {
    const otherOrg = buildOrganizerUser("org-2");
    await expect(
      participantProfileService.update(otherOrg, "org-1", "u-99", { tags: ["X"] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("participantProfileService.bulkTagFromRegistrations", () => {
  it("returns applied=0 when add and remove deltas are both empty", async () => {
    const user = buildOrganizerUser("org-1");
    const result = await participantProfileService.bulkTagFromRegistrations(user, "org-1", {
      registrationIds: ["r1", "r2"],
      addTags: [],
      removeTags: [],
    });
    expect(result.applied).toBe(0);
  });

  it("rejects callers without permission", async () => {
    const participant = buildAuthUser({ roles: ["participant"], organizationId: "org-1" });
    await expect(
      participantProfileService.bulkTagFromRegistrations(participant, "org-1", {
        registrationIds: ["r1"],
        addTags: ["VIP"],
        removeTags: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
