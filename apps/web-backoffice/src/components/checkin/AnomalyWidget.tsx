"use client";

// ─── Security Anomalies Widget ─────────────────────────────────────────────
// Polls `/v1/events/:eventId/checkin/anomalies` every 10 s and renders the
// three anomaly kinds (duplicate / device mismatch / velocity outlier) as
// a single prioritised feed. Gated on `advancedAnalytics` — free/starter
// orgs see an upsell card that links to the billing page.
//
// Placement: Dashboard tab of the live check-in page, between the global
// progress bar and the zone/ticket breakdown grid. That's the eye-line a
// gate supervisor lands on when they open the tab, so anomalies can't
// hide below the fold.
//
// Severity palette mirrors the shared status colours used elsewhere:
//   - critical → red   (likely fraud — velocity burst, confirmed device mismatch)
//   - warning  → amber (needs review — duplicate scans)
//   - info     → blue  (noteworthy but low signal — first device change)

import { useMemo, useState } from "react";
import { Card, CardContent } from "@teranga/shared-ui";
import { useCheckinAnomalies } from "@/hooks/use-checkin";
import { usePlanGating } from "@/hooks/use-plan-gating";
import { usePlansCatalogMap } from "@/hooks/use-plans-catalog";
import {
  AlertTriangle,
  ShieldAlert,
  Smartphone,
  Zap,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ArrowUpRight,
  Lock,
} from "lucide-react";
import Link from "next/link";
import type { Anomaly, AnomalyEvidence, AnomalyResponse } from "@teranga/shared-types";

interface AnomalyWidgetProps {
  eventId: string;
}

// Gate at the top: when the org doesn't have `advancedAnalytics`, the
// inner component (and therefore `useCheckinAnomalies`) never mounts, so
// we never burn a React Query slot nor fire the fetch. This matches the
// upsell-vs-live split security-reviewer flagged on the first pass.
export function AnomalyWidget({ eventId }: AnomalyWidgetProps) {
  const { canUse } = usePlanGating();
  if (!canUse("advancedAnalytics")) {
    return <AnomalyUpsellCard />;
  }
  return <AnomalyWidgetInner eventId={eventId} />;
}

function AnomalyWidgetInner({ eventId }: AnomalyWidgetProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  // Pause polling while a row is expanded so the drill-down the user is
  // reading doesn't get yanked out from under them mid-sentence.
  const { data, isLoading, isError } = useCheckinAnomalies(
    eventId,
    { windowMinutes: 10, velocityThreshold: 60 },
    { paused: expanded !== null },
  );

  const response = data?.data;
  const allAnomalies = useMemo(() => (response ? flattenAnomalies(response) : []), [response]);

  if (isLoading) {
    return (
      <Card className="mb-6">
        <CardContent className="p-6">
          <WidgetHeader />
          <p className="text-sm text-muted-foreground">Analyse des anomalies en cours...</p>
        </CardContent>
      </Card>
    );
  }

  if (isError || !response) {
    return (
      <Card className="mb-6">
        <CardContent className="p-6">
          <WidgetHeader />
          <p className="text-sm text-muted-foreground">
            Impossible de charger les anomalies pour le moment.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (allAnomalies.length === 0) {
    return (
      <Card className="mb-6 border-green-200 dark:border-green-900/40">
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            <div className="shrink-0 rounded-full bg-green-100 dark:bg-green-900/30 p-2">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Sécurité des scans</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Aucune anomalie détectée sur les {response.meta.windowMinutes} dernières minutes.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      <CardContent className="p-6">
        <WidgetHeader count={allAnomalies.length} windowMinutes={response.meta.windowMinutes} />
        <div className="mt-4 space-y-2">
          {allAnomalies.map((anomaly) => {
            const id = anomalyKey(anomaly);
            return (
              <AnomalyRow
                key={id}
                anomaly={anomaly}
                velocityThreshold={response.meta.velocityThreshold}
                isOpen={expanded === id}
                onToggle={() => setExpanded(expanded === id ? null : id)}
              />
            );
          })}
        </div>
        {response.meta.truncated && (
          <p className="mt-3 text-xs text-muted-foreground">
            Fenêtre tronquée — plus de {response.meta.scannedRows} scans analysés. Les anomalies les
            plus récentes sont affichées en premier.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Upsell card ───────────────────────────────────────────────────────────
// Not reusing <PlanGate blur={...}> because that pattern assumes there's
// meaningful content to blur. Here the free/starter UX is "nothing to
// show", so we render a dedicated upsell that explains what they'd get.
function AnomalyUpsellCard() {
  const { map: catalog } = usePlansCatalogMap();
  const requiredPlanName = useMemo(() => {
    const plans = Array.from(catalog.values()).sort((a, b) => a.sortOrder - b.sortOrder);
    const match = plans.find((p) => p.features?.advancedAnalytics);
    return match?.name.fr ?? "Pro";
  }, [catalog]);

  return (
    <Card className="mb-6 border-teranga-gold-dark/30 bg-teranga-gold-soft/30">
      <CardContent className="p-6">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-full bg-teranga-gold-soft p-2">
            <ShieldAlert className="h-5 w-5 text-teranga-gold-dark" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              Sécurité des scans
              <span className="inline-flex items-center gap-1 rounded-md bg-teranga-gold-soft px-2 py-0.5 text-xs font-medium text-teranga-gold-dark">
                <Lock className="h-3 w-3" />
                {requiredPlanName}
              </span>
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              Détectez les scans dupliqués, les QR partagés entre plusieurs appareils et les rafales
              suspectes en temps réel. Disponible avec le plan {requiredPlanName}.
            </p>
            <Link
              href="/organization/billing"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-teranga-gold-dark px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teranga-gold-dark/90"
            >
              Passer au plan {requiredPlanName}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Widget header ─────────────────────────────────────────────────────────
function WidgetHeader({ count, windowMinutes }: { count?: number; windowMinutes?: number }) {
  return (
    <div className="flex items-start justify-between mb-2">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <ShieldAlert className="h-5 w-5" />
          Sécurité des scans
          {count !== undefined && count > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 text-xs font-semibold px-2">
              {count}
            </span>
          )}
        </h2>
        {windowMinutes !== undefined && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Fenêtre glissante : {windowMinutes} min • Mise à jour toutes les 10 s
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Single row ─────────────────────────────────────────────────────────────
// One component for all three kinds. Switch on `anomaly.kind` inside so
// adding a fourth kind later (clock skew, zone overflow) is a one-case
// change here plus a shared-types update.
function AnomalyRow({
  anomaly,
  velocityThreshold,
  isOpen,
  onToggle,
}: {
  anomaly: Anomaly;
  velocityThreshold: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { icon, label, explainer, severityClass } = describeAnomaly(anomaly, velocityThreshold);

  return (
    <div
      className={`rounded-lg border ${severityClass.border} ${severityClass.bg} overflow-hidden`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
        aria-expanded={isOpen}
      >
        <div className={`shrink-0 rounded-full p-2 ${severityClass.iconBg}`}>{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-semibold ${severityClass.text}`}>{label}</span>
            <span className="text-xs text-muted-foreground">
              {formatRelative(latestScan(anomaly))}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{explainer}</p>
        </div>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 mt-2" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-2" />
        )}
      </button>
      {isOpen && (
        <div className="border-t border-inherit bg-background/60 px-4 py-3">
          <EvidenceTable evidence={anomaly.evidence} />
        </div>
      )}
    </div>
  );
}

// ─── Evidence drill-down ────────────────────────────────────────────────────
function EvidenceTable({ evidence }: { evidence: AnomalyEvidence[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-1 font-medium">Heure</th>
          <th className="py-1 font-medium">Appareil</th>
          <th className="py-1 font-medium">Staff</th>
          <th className="py-1 font-medium">Zone</th>
        </tr>
      </thead>
      <tbody>
        {evidence.map((e) => (
          <tr key={e.checkinId} className="border-t border-border/50">
            <td className="py-1.5 font-mono">{formatTimeOnly(e.scannedAt)}</td>
            <td className="py-1.5 font-mono truncate max-w-[10rem]" title={e.scannerDeviceId ?? ""}>
              {e.scannerDeviceId ? shortDevice(e.scannerDeviceId) : "—"}
            </td>
            <td className="py-1.5 font-mono truncate max-w-[8rem]" title={e.scannedBy}>
              {e.scannedBy.slice(0, 8)}
            </td>
            <td className="py-1.5">{e.accessZoneId ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function flattenAnomalies(response: AnomalyResponse): Anomaly[] {
  const all: Anomaly[] = [
    ...response.duplicates,
    ...response.deviceMismatches,
    ...response.velocityOutliers,
  ];
  // Sort severity first, then by most recent evidence. Critical events
  // float to the top; within a severity tier the anomaly whose latest
  // scan is newest wins. We deliberately do NOT use `detectedAt` here —
  // the server stamps that with query-time `new Date()`, so it's the
  // same value for every row in a single response and useless for
  // ordering.
  const severityWeight: Record<Anomaly["severity"], number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  return all.sort((a, b) => {
    const s = severityWeight[a.severity] - severityWeight[b.severity];
    if (s !== 0) return s;
    return latestScan(b).localeCompare(latestScan(a));
  });
}

/**
 * Latest `scannedAt` inside an anomaly's evidence. Used both for
 * severity-tied sort order and for the "il y a N min" label on the row —
 * the gate supervisor cares about when the offending scan actually
 * landed, not when our query noticed it.
 */
function latestScan(anomaly: Anomaly): string {
  let max = "";
  for (const e of anomaly.evidence) {
    if (e.scannedAt > max) max = e.scannedAt;
  }
  return max;
}

/**
 * Stable React key — survives polling. Must NOT include `detectedAt`:
 * the backend recomputes `detectedAt = new Date()` on every request, so
 * embedding it would flip the key every 10 s and collapse any expanded
 * drill-down mid-read. Instead, pin on the anomaly's natural identity:
 * `kind + registration/staff id`. Two successive polls that re-detect
 * the same fraud pattern render as the same row, preserving expansion.
 */
function anomalyKey(anomaly: Anomaly): string {
  switch (anomaly.kind) {
    case "duplicate":
      return `dup:${anomaly.registrationId}`;
    case "device_mismatch":
      return `dev:${anomaly.registrationId}`;
    case "velocity_outlier":
      return `vel:${anomaly.scannedBy}`;
  }
}

interface SeverityStyle {
  border: string;
  bg: string;
  iconBg: string;
  text: string;
}

function severityStyle(severity: Anomaly["severity"]): SeverityStyle {
  switch (severity) {
    case "critical":
      return {
        border: "border-red-200 dark:border-red-900/40",
        bg: "bg-red-50/60 dark:bg-red-900/10",
        iconBg: "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400",
        text: "text-red-700 dark:text-red-300",
      };
    case "warning":
      return {
        border: "border-amber-200 dark:border-amber-900/40",
        bg: "bg-amber-50/60 dark:bg-amber-900/10",
        iconBg: "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400",
        text: "text-amber-700 dark:text-amber-300",
      };
    case "info":
      return {
        border: "border-blue-200 dark:border-blue-900/40",
        bg: "bg-blue-50/60 dark:bg-blue-900/10",
        iconBg: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
        text: "text-blue-700 dark:text-blue-300",
      };
  }
}

function describeAnomaly(
  anomaly: Anomaly,
  velocityThreshold: number,
): {
  icon: React.ReactNode;
  label: string;
  explainer: string;
  severityClass: SeverityStyle;
} {
  const severityClass = severityStyle(anomaly.severity);
  switch (anomaly.kind) {
    case "duplicate":
      return {
        icon: <AlertTriangle className="h-4 w-4" />,
        label: "Scan dupliqué",
        explainer: `Le QR ${shortId(anomaly.registrationId)} a été scanné ${anomaly.evidence.length} fois.`,
        severityClass,
      };
    case "device_mismatch":
      return {
        icon: <Smartphone className="h-4 w-4" />,
        label: "QR partagé entre appareils",
        explainer: `Le même badge a été scanné sur ${anomaly.deviceIds.length} appareils différents.`,
        severityClass,
      };
    case "velocity_outlier":
      return {
        icon: <Zap className="h-4 w-4" />,
        label: "Rafale de scans anormale",
        explainer: `${anomaly.count} scans en une minute (seuil : ${velocityThreshold}/min).`,
        severityClass,
      };
  }
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function shortDevice(deviceId: string): string {
  return deviceId.length > 14 ? `${deviceId.slice(0, 10)}…` : deviceId;
}

function formatRelative(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return "à l'instant";
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 60) return `il y a ${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `il y a ${hr} h`;
  return new Date(iso).toLocaleString("fr-FR");
}

function formatTimeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
