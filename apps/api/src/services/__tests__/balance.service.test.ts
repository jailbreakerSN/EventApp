import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildAuthUser, buildOrganizerUser, buildSuperAdmin } from "@/__tests__/factories";
import type { BalanceTransaction } from "@teranga/shared-types";

const { mockRepo } = vi.hoisted(() => ({
  mockRepo: {
    findAllByOrganization: vi.fn(),
    findByOrganization: vi.fn(),
  },
}));

vi.mock("@/repositories/balance-transaction.repository", () => ({
  balanceTransactionRepository: new Proxy(
    {},
    {
      get: (_t, p) => (mockRepo as Record<string, unknown>)[p as string],
    },
  ),
}));

vi.mock("@/config/firebase", () => ({
  db: {},
  COLLECTIONS: {},
}));

import { balanceService } from "../balance.service";

// ─── Builders ──────────────────────────────────────────────────────────────

function entry(overrides: Partial<BalanceTransaction>): BalanceTransaction {
  return {
    id: overrides.id ?? "tx-1",
    organizationId: overrides.organizationId ?? "org-1",
    eventId: overrides.eventId ?? "ev-1",
    paymentId: overrides.paymentId ?? null,
    payoutId: overrides.payoutId ?? null,
    kind: "payment",
    amount: 0,
    currency: "XOF",
    status: "pending",
    availableOn: "2026-04-16T00:00:00.000Z",
    description: "",
    createdBy: "system:test",
    createdAt: "2026-04-16T00:00:00.000Z",
    ...overrides,
  } as BalanceTransaction;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── getBalance ────────────────────────────────────────────────────────────

describe("BalanceService.getBalance", () => {
  const orgId = "org-1";
  const organizer = buildOrganizerUser(orgId);

  it("returns folded balance for authorized organizer", async () => {
    mockRepo.findAllByOrganization.mockResolvedValue([
      entry({ kind: "payment", amount: 10_000, status: "available" }),
      entry({ kind: "platform_fee", amount: -500, status: "available" }),
    ]);

    const result = await balanceService.getBalance(orgId, organizer);

    expect(mockRepo.findAllByOrganization).toHaveBeenCalledWith(orgId);
    expect(result.available).toBe(9_500);
    expect(result.lifetimeRevenue).toBe(10_000);
    expect(result.lifetimeFees).toBe(500);
  });

  it("rejects participants (no payment:view_reports permission)", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });
    await expect(balanceService.getBalance(orgId, participant)).rejects.toThrow(
      "Permission manquante",
    );
    expect(mockRepo.findAllByOrganization).not.toHaveBeenCalled();
  });

  it("rejects organizers from other organizations", async () => {
    const otherOrg = buildOrganizerUser("org-other");
    await expect(balanceService.getBalance(orgId, otherOrg)).rejects.toThrow("Accès refusé");
    expect(mockRepo.findAllByOrganization).not.toHaveBeenCalled();
  });

  it("allows super_admin regardless of organization", async () => {
    const admin = buildSuperAdmin();
    mockRepo.findAllByOrganization.mockResolvedValue([]);

    const result = await balanceService.getBalance(orgId, admin);

    expect(result.available).toBe(0);
    expect(result.lifetimeRevenue).toBe(0);
  });
});

// ─── listTransactions ──────────────────────────────────────────────────────

describe("BalanceService.listTransactions", () => {
  const orgId = "org-1";
  const organizer = buildOrganizerUser(orgId);

  it("forwards filters to the repository and returns paginated result", async () => {
    mockRepo.findByOrganization.mockResolvedValue({
      data: [entry({ kind: "payment", amount: 5_000 })],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    });

    const result = await balanceService.listTransactions(
      orgId,
      { kind: "payment", page: 1, limit: 20 },
      organizer,
    );

    expect(mockRepo.findByOrganization).toHaveBeenCalledWith(
      orgId,
      { kind: "payment" },
      { page: 1, limit: 20 },
    );
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });

  it("rejects participants", async () => {
    const participant = buildAuthUser({ roles: ["participant"] });
    await expect(
      balanceService.listTransactions(orgId, { page: 1, limit: 20 }, participant),
    ).rejects.toThrow("Permission manquante");
  });

  it("rejects organizers from other organizations", async () => {
    const otherOrg = buildOrganizerUser("org-other");
    await expect(
      balanceService.listTransactions(orgId, { page: 1, limit: 20 }, otherOrg),
    ).rejects.toThrow("Accès refusé");
  });
});
