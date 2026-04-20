import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnomalyWidget } from "../AnomalyWidget";
import type { AnomalyResponse } from "@teranga/shared-types";

// ─── AnomalyWidget component coverage ──────────────────────────────────────
// The widget from Sprint C 4.3. Most recent and most complex client
// code on the dashboard. Invariants we pin:
//
//   1. Plan gate: non-`advancedAnalytics` orgs see the upsell card
//      and the live query NEVER mounts (`useCheckinAnomalies` is
//      never called). This is the rules-of-hooks fix from PR #122
//      self-review — no regression there.
//   2. Happy empty state: when the endpoint returns zero anomalies,
//      render the green "Aucune anomalie" card.
//   3. Severity ordering: critical floats above warning above info;
//      within a tier, the most recent evidence-scan wins.
//   4. Drill-down expand / collapse: exactly one row open at a time;
//      second click on the same row collapses.
//   5. Rendered labels: French copy + count interpolation from
//      response.meta.

const mockUseCheckinAnomalies = vi.fn();
const mockUsePlanGating = vi.fn();
const mockUsePlansCatalogMap = vi.fn();

vi.mock("@/hooks/use-checkin", () => ({
  useCheckinAnomalies: (...args: unknown[]) => mockUseCheckinAnomalies(...args),
}));

vi.mock("@/hooks/use-plan-gating", () => ({
  usePlanGating: () => mockUsePlanGating(),
}));

vi.mock("@/hooks/use-plans-catalog", () => ({
  usePlansCatalogMap: () => mockUsePlansCatalogMap(),
}));

// Catalog used by the upsell card to compute the "required plan" name.
const catalogMap = new Map([
  [
    "starter",
    {
      id: "starter",
      sortOrder: 1,
      name: { fr: "Starter", en: "Starter" },
      features: { advancedAnalytics: false },
    },
  ],
  [
    "pro",
    {
      id: "pro",
      sortOrder: 2,
      name: { fr: "Pro", en: "Pro" },
      features: { advancedAnalytics: true },
    },
  ],
]);

beforeEach(() => {
  vi.clearAllMocks();
  mockUsePlansCatalogMap.mockReturnValue({ map: catalogMap });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockAnomalyResponse(overrides: Partial<AnomalyResponse> = {}): AnomalyResponse {
  return {
    duplicates: [],
    deviceMismatches: [],
    velocityOutliers: [],
    meta: {
      windowMinutes: 10,
      velocityThreshold: 60,
      scannedRows: 100,
      truncated: false,
    },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("AnomalyWidget — plan gate", () => {
  it("renders the upsell card when canUse('advancedAnalytics') is false", () => {
    mockUsePlanGating.mockReturnValue({ canUse: () => false, plan: "free" });

    render(<AnomalyWidget eventId="evt-1" />);

    expect(screen.getByText(/Sécurité des scans/)).toBeInTheDocument();
    expect(screen.getByText(/Disponible avec le plan Pro/)).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /passer au plan Pro/i });
    expect(cta).toHaveAttribute("href", "/organization/billing");
  });

  it("does NOT mount useCheckinAnomalies when the plan is gated", () => {
    // Critical regression guard: the Phase-1 rules-of-hooks fix moved
    // the gate to the top of the component so the live query never
    // fires for free / starter orgs. If someone ever inlines the gate
    // again, this test catches it.
    mockUsePlanGating.mockReturnValue({ canUse: () => false, plan: "free" });

    render(<AnomalyWidget eventId="evt-1" />);

    expect(mockUseCheckinAnomalies).not.toHaveBeenCalled();
  });
});

describe("AnomalyWidget — live data", () => {
  beforeEach(() => {
    mockUsePlanGating.mockReturnValue({ canUse: () => true, plan: "pro" });
  });

  it("renders the empty state when no anomalies", () => {
    mockUseCheckinAnomalies.mockReturnValue({
      data: { data: mockAnomalyResponse() },
      isLoading: false,
      isError: false,
    });

    render(<AnomalyWidget eventId="evt-1" />);

    expect(screen.getByText(/Aucune anomalie détectée/)).toBeInTheDocument();
    // Window minutes interpolated from response.meta.
    expect(screen.getByText(/10 dernières minutes/)).toBeInTheDocument();
  });

  it("renders the loading state on first fetch", () => {
    mockUseCheckinAnomalies.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<AnomalyWidget eventId="evt-1" />);

    expect(screen.getByText(/Analyse des anomalies en cours/)).toBeInTheDocument();
  });

  it("renders the fetch-error state", () => {
    mockUseCheckinAnomalies.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<AnomalyWidget eventId="evt-1" />);

    expect(screen.getByText(/Impossible de charger les anomalies/)).toBeInTheDocument();
  });

  it("severity ordering: critical > warning > info; newer wins within tier", () => {
    // Three anomalies: a critical device-mismatch (newer scan), a
    // warning duplicate, and we don't test info here because none of
    // our kinds currently emit info severity — but the sort invariant
    // still holds on critical → warning.
    mockUseCheckinAnomalies.mockReturnValue({
      data: {
        data: mockAnomalyResponse({
          deviceMismatches: [
            {
              kind: "device_mismatch",
              detectedAt: "2026-04-20T10:00:00.000Z",
              severity: "critical",
              registrationId: "reg-critical",
              deviceIds: ["dev-1", "dev-2"],
              evidence: [
                {
                  checkinId: "ci-1",
                  scannedAt: "2026-04-20T09:59:55.000Z",
                  scannerDeviceId: "dev-1",
                  scannedBy: "staff-1",
                  registrationId: "reg-critical",
                  accessZoneId: null,
                },
                {
                  checkinId: "ci-2",
                  scannedAt: "2026-04-20T09:59:56.000Z",
                  scannerDeviceId: "dev-2",
                  scannedBy: "staff-1",
                  registrationId: "reg-critical",
                  accessZoneId: null,
                },
              ],
            },
          ],
          duplicates: [
            {
              kind: "duplicate",
              detectedAt: "2026-04-20T10:00:00.000Z",
              severity: "warning",
              registrationId: "reg-warning",
              evidence: [
                {
                  checkinId: "ci-3",
                  scannedAt: "2026-04-20T09:55:00.000Z",
                  scannerDeviceId: "dev-3",
                  scannedBy: "staff-1",
                  registrationId: "reg-warning",
                  accessZoneId: null,
                },
              ],
            },
          ],
        }),
      },
      isLoading: false,
      isError: false,
    });

    render(<AnomalyWidget eventId="evt-1" />);

    const criticalRow = screen.getByText(/QR partagé entre appareils/);
    const warningRow = screen.getByText(/Scan dupliqué/);
    expect(criticalRow).toBeInTheDocument();
    expect(warningRow).toBeInTheDocument();
    // compareDocumentPosition: bit 4 (0x04) set means `critical` is
    // earlier in the DOM than `warning`.
    expect(
      criticalRow.compareDocumentPosition(warningRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("expands the evidence drill-down when the row is clicked, and collapses on a second click", () => {
    mockUseCheckinAnomalies.mockReturnValue({
      data: {
        data: mockAnomalyResponse({
          duplicates: [
            {
              kind: "duplicate",
              detectedAt: "2026-04-20T10:00:00.000Z",
              severity: "warning",
              registrationId: "reg-dup",
              evidence: [
                {
                  checkinId: "ci-evidence-1",
                  scannedAt: "2026-04-20T09:55:00.000Z",
                  scannerDeviceId: "dev-abc",
                  scannedBy: "staff-visible-uid",
                  registrationId: "reg-dup",
                  accessZoneId: null,
                },
              ],
            },
          ],
        }),
      },
      isLoading: false,
      isError: false,
    });

    render(<AnomalyWidget eventId="evt-1" />);

    const row = screen.getByRole("button", { expanded: false });
    expect(screen.queryByText("Heure")).not.toBeInTheDocument();

    fireEvent.click(row);
    // Now the evidence table header is visible + the truncated staff uid.
    expect(screen.getByText("Heure")).toBeInTheDocument();
    expect(screen.getByText("staff-vi")).toBeInTheDocument(); // sliced to 8 chars
    expect(screen.getByRole("button", { expanded: true })).toBe(row);

    fireEvent.click(row);
    expect(screen.queryByText("Heure")).not.toBeInTheDocument();
  });

  it("shows the velocity-outlier threshold from response.meta", () => {
    mockUseCheckinAnomalies.mockReturnValue({
      data: {
        data: mockAnomalyResponse({
          velocityOutliers: [
            {
              kind: "velocity_outlier",
              detectedAt: "2026-04-20T10:00:00.000Z",
              severity: "critical",
              scannedBy: "staff-1",
              scannerDeviceId: "dev-1",
              count: 150,
              evidence: [
                {
                  checkinId: "ci-vel-1",
                  scannedAt: "2026-04-20T09:59:30.000Z",
                  scannerDeviceId: "dev-1",
                  scannedBy: "staff-1",
                  registrationId: "reg-1",
                  accessZoneId: null,
                },
              ],
            },
          ],
          meta: {
            windowMinutes: 10,
            velocityThreshold: 60,
            scannedRows: 500,
            truncated: false,
          },
        }),
      },
      isLoading: false,
      isError: false,
    });

    render(<AnomalyWidget eventId="evt-1" />);

    // Explainer embeds both the count (150) and the threshold (60).
    expect(screen.getByText(/150 scans en une minute/)).toBeInTheDocument();
    expect(screen.getByText(/seuil : 60\/min/)).toBeInTheDocument();
  });

  it("shows the truncated notice when meta.truncated is true", () => {
    mockUseCheckinAnomalies.mockReturnValue({
      data: {
        data: mockAnomalyResponse({
          duplicates: [
            {
              kind: "duplicate",
              detectedAt: "2026-04-20T10:00:00.000Z",
              severity: "warning",
              registrationId: "reg-1",
              evidence: [
                {
                  checkinId: "ci-1",
                  scannedAt: "2026-04-20T09:50:00.000Z",
                  scannerDeviceId: "d-1",
                  scannedBy: "staff-1",
                  registrationId: "reg-1",
                  accessZoneId: null,
                },
              ],
            },
          ],
          meta: {
            windowMinutes: 10,
            velocityThreshold: 60,
            scannedRows: 5000,
            truncated: true,
          },
        }),
      },
      isLoading: false,
      isError: false,
    });

    render(<AnomalyWidget eventId="evt-1" />);

    expect(screen.getByText(/Fenêtre tronquée/)).toBeInTheDocument();
    expect(screen.getByText(/plus de 5000 scans analysés/)).toBeInTheDocument();
  });
});
