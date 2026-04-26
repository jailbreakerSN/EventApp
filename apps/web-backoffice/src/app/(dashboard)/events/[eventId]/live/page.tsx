"use client";

/**
 * Organizer overhaul — Phase O8.
 *
 * Live Event Mode (Floor Ops). Full-screen control room for the day
 * of the event:
 *
 *   ┌────────────────────────────────────────────┐
 *   │ Header:  event title · clock · exit         │
 *   ├──────────────┬──────────────────────────────┤
 *   │ Stats grid   │ Incidents log                 │
 *   │  - Scan rate │  - filter pills               │
 *   │  - Queue     │  - create form                │
 *   │  - No-show   │  - rows w/ severity color     │
 *   │  - Staff     │                                │
 *   ├──────────────┴──────────────────────────────┤
 *   │ Staff radio (full-width, real-time)         │
 *   ├─────────────────────────────────────────────┤
 *   │ Emergency broadcast button (sticky, red)    │
 *   └─────────────────────────────────────────────┘
 *
 * The route is *intentionally* listed in `isFullScreenRoute()` of the
 * event layout (parallel to /checkin) so the standard 4-section
 * chrome is bypassed. Operators stay focused; the only navigation
 * affordance is "Quitter le mode live" → back to /overview.
 *
 * Auto-refresh: live stats poll every 60 s (handled by the hook).
 * Realtime: staff radio uses Firestore onSnapshot (no polling).
 *
 * J-0 gating: the page renders even outside the J-0 window (operator
 * may want to dry-run), but a banner warns when the event isn't on
 * "today" — the entry point on /overview only surfaces during J-0
 * ±6 h to avoid surprises.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Clock,
  ScanLine,
  ShieldAlert,
  Users,
  UsersRound,
} from "lucide-react";
import { Button, Card, CardContent, Skeleton } from "@teranga/shared-ui";
import { useEvent } from "@/hooks/use-events";
import { useAuth } from "@/hooks/use-auth";
import { usePlanGating } from "@/hooks/use-plan-gating";
import { useLiveStats } from "@/hooks/use-live-ops";
import { ScanRateChart } from "@/components/live-ops/ScanRateChart";
import { IncidentLog } from "@/components/live-ops/IncidentLog";
import { StaffRadio } from "@/components/live-ops/StaffRadio";
import { EmergencyBroadcastDialog } from "@/components/live-ops/EmergencyBroadcastDialog";
import { isLiveWindow } from "@/lib/live-window";
import { cn } from "@/lib/utils";

export default function EventLivePage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { user } = useAuth();
  const { canUse } = usePlanGating();
  const { data: eventResp, isLoading: eventLoading } = useEvent(eventId ?? "");
  const event = eventResp?.data;

  const { data: stats, isLoading: statsLoading } = useLiveStats(eventId);

  const [emergencyOpen, setEmergencyOpen] = useState(false);

  const inLiveWindow = useMemo(() => {
    if (!event) return false;
    return isLiveWindow(event.startDate, event.endDate ?? null, new Date());
  }, [event]);

  if (eventLoading) {
    return (
      <div className="min-h-screen p-6 space-y-4">
        <Skeleton variant="text" className="h-7 w-1/2" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton variant="rectangle" className="h-48" />
          <Skeleton variant="rectangle" className="h-48" />
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen p-6">
        <p className="text-sm text-muted-foreground">Événement introuvable.</p>
        <Link href="/events" className="text-sm text-primary underline">
          Retour à la liste
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-muted/20">
      {/* Header */}
      <header className="border-b border-border bg-background sticky top-0 z-30">
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={`/events/${eventId}/overview`}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Quitter le mode live
            </Link>
            <span className="hidden sm:inline text-muted-foreground">·</span>
            <h1 className="text-base sm:text-lg font-semibold truncate">{event.title}</h1>
            <span className="hidden md:inline-flex items-center gap-1 text-xs uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500/15 text-red-600 dark:text-red-400">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 motion-safe:animate-pulse" />
              Live
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setEmergencyOpen(true)}
              className="gap-1.5"
            >
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Alerte d&apos;urgence</span>
              <span className="sm:hidden">Alerte</span>
            </Button>
          </div>
        </div>

        {!inLiveWindow && (
          <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-t border-amber-200 dark:border-amber-900/60 text-xs flex items-start gap-2 text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Cet événement n&apos;est pas dans la fenêtre J-0 ±6 h. Le mode live reste accessible
              pour répétition, mais les chiffres seront vides ou stables.
            </span>
          </div>
        )}
      </header>

      <main className="flex-1 p-4 space-y-4 max-w-7xl mx-auto w-full">
        {/* Stats grid */}
        <section
          aria-label="Indicateurs en direct"
          className="grid grid-cols-2 lg:grid-cols-4 gap-3"
        >
          <StatTile
            icon={<ScanLine className="h-4 w-4" />}
            label="Scans / min"
            primary={
              statsLoading ? "…" : String(stats?.scanRate?.[stats.scanRate.length - 1]?.count ?? 0)
            }
            footer={
              <ScanRateChart
                buckets={stats?.scanRate ?? []}
                width={180}
                height={48}
                className="-mb-1"
              />
            }
          />
          <StatTile
            icon={<Users className="h-4 w-4" />}
            label="File estimée"
            primary={statsLoading ? "…" : String(stats?.queueEstimate ?? 0)}
            footer={<p className="text-[11px] text-muted-foreground">Inscrits non scannés</p>}
          />
          <StatTile
            icon={<Activity className="h-4 w-4" />}
            label="No-show estimé"
            primary={statsLoading ? "…" : String(stats?.noShowEstimate ?? 0)}
            footer={<p className="text-[11px] text-muted-foreground">Calculé après la fin</p>}
          />
          <StatTile
            icon={<UsersRound className="h-4 w-4" />}
            label="Staff en ligne"
            primary={statsLoading ? "…" : String(stats?.staffOnline ?? 0)}
            footer={<p className="text-[11px] text-muted-foreground">Activité &lt; 5 min</p>}
          />
        </section>

        {/* Incidents + Staff radio */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <IncidentLog eventId={eventId ?? ""} currentUserId={user?.uid} />
          <StaffRadio eventId={eventId ?? ""} currentUserId={user?.uid} className="min-h-[420px]" />
        </div>
      </main>

      <EmergencyBroadcastDialog
        eventId={eventId ?? ""}
        open={emergencyOpen}
        onClose={() => setEmergencyOpen(false)}
        whatsappEnabled={canUse("whatsappNotifications")}
      />
    </div>
  );
}

interface StatTileProps {
  icon: React.ReactNode;
  label: string;
  primary: string;
  footer?: React.ReactNode;
}

function StatTile({ icon, label, primary, footer }: StatTileProps) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {icon}
            {label}
          </span>
          <Clock className="h-3 w-3 opacity-60" aria-hidden="true" />
        </div>
        <p className={cn("mt-1 text-2xl font-semibold tabular-nums")}>{primary}</p>
        {footer && <div className="mt-1.5">{footer}</div>}
      </CardContent>
    </Card>
  );
}
