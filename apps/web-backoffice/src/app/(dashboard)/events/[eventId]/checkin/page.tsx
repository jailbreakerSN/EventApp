"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useEvent } from "@/hooks/use-events";
import { useCheckinStats, useCheckinHistory, usePerformCheckin } from "@/hooks/use-checkin";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Input,
  Select,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  EmptyState,
  DataTable,
  Skeleton,
  type DataTableColumn,
} from "@teranga/shared-ui";
import {
  ArrowLeft,
  Users,
  UserCheck,
  Clock,
  MapPin,
  Loader2,
  History,
  RefreshCw,
  QrCode,
  BarChart3,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Search,
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Short relative time — "il y a 12 s", "il y a 3 min". Used on the
 * duplicate-scan card where the gate staff needs a quick "how long ago
 * did the first scan land?" without pulling in a date-fns bundle.
 */
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

// ─── Types ──────────────────────────────────────────────────────────────────

type ScanStatus =
  | "idle"
  | "loading"
  | "success"
  | "already_checked_in"
  | "expired"
  | "not_yet_valid"
  | "error";

interface ScanResult {
  status: ScanStatus;
  participantName?: string | null;
  ticketType?: string | null;
  accessZone?: string | null;
  checkedInAt?: string | null;
  errorMessage?: string;
  // Duplicate-scan enrichment (badge-journey-review 3.5) — lets the
  // "Déjà validé" card name the scanner who got there first instead of
  // leaving the staff member guessing.
  checkedInBy?: string | null;
  checkedInByName?: string | null;
  checkedInDeviceId?: string | null;
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function CheckinDashboardPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const router = useRouter();

  const { data: eventData, isLoading: eventLoading } = useEvent(eventId);
  const { data: statsData, isLoading: statsLoading } = useCheckinStats(eventId);
  const { data: recentData } = useCheckinHistory(eventId, { limit: 10, page: 1 });

  const event = (eventData as { data?: Record<string, unknown> })?.data as
    | Record<string, unknown>
    | undefined;
  const stats = (statsData as { data?: Record<string, unknown> })?.data as
    | Record<string, unknown>
    | undefined;
  const recentEntries = (recentData as { data?: Array<Record<string, unknown>> })?.data ?? [];

  if (eventLoading || statsLoading) {
    return (
      <div className="space-y-4" role="status" aria-label="Chargement du tableau de bord">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Evenement introuvable</p>
      </div>
    );
  }

  const totalRegistered = (stats?.totalRegistered as number) ?? 0;
  const totalCheckedIn = (stats?.totalCheckedIn as number) ?? 0;
  const totalPending = (stats?.totalPending as number) ?? 0;
  const percentage = totalRegistered > 0 ? Math.round((totalCheckedIn / totalRegistered) * 100) : 0;
  const lastCheckinAt = stats?.lastCheckinAt as string | null;
  const byZone =
    (stats?.byZone as Array<{
      zoneId: string;
      zoneName: string;
      checkedIn: number;
      capacity: number | null;
    }>) ?? [];
  const byTicketType =
    (stats?.byTicketType as Array<{
      ticketTypeId: string;
      ticketTypeName: string;
      registered: number;
      checkedIn: number;
    }>) ?? [];

  // Extract access zones from event data
  const accessZones =
    (event.accessZones as Array<{
      id: string;
      name: string;
      color: string;
      capacity?: number | null;
    }>) ?? [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/events/${eventId}`)}
            className="p-2 rounded-lg hover:bg-accent"
            aria-label="Retour a l'evenement"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Check-in en direct</h1>
            <p className="text-sm text-muted-foreground">{event.title as string}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3" />
          Actualisation auto toutes les 10s
        </div>
      </div>

      {/* Tabs: Dashboard + Scanner */}
      <Tabs defaultValue="scanner">
        <TabsList className="mb-6">
          <TabsTrigger value="scanner" className="gap-2">
            <QrCode className="h-4 w-4" />
            Scanner
          </TabsTrigger>
          <TabsTrigger value="dashboard" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Tableau de bord
          </TabsTrigger>
        </TabsList>

        {/* ─── Scanner Tab ──────────────────────────────────────── */}
        <TabsContent value="scanner">
          <ScannerTab
            eventId={eventId}
            accessZones={accessZones}
            byZone={byZone}
            recentEntries={recentEntries}
            totalCheckedIn={totalCheckedIn}
            totalRegistered={totalRegistered}
          />
        </TabsContent>

        {/* ─── Dashboard Tab ────────────────────────────────────── */}
        <TabsContent value="dashboard">
          <DashboardTab
            eventId={eventId}
            totalRegistered={totalRegistered}
            totalCheckedIn={totalCheckedIn}
            totalPending={totalPending}
            percentage={percentage}
            lastCheckinAt={lastCheckinAt}
            byZone={byZone}
            byTicketType={byTicketType}
            recentEntries={recentEntries}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Scanner Tab ────────────────────────────────────────────────────────────

function ScannerTab({
  eventId,
  accessZones,
  byZone,
  recentEntries,
  totalCheckedIn,
  totalRegistered,
}: {
  eventId: string;
  accessZones: Array<{ id: string; name: string; color: string; capacity?: number | null }>;
  byZone: Array<{ zoneId: string; zoneName: string; checkedIn: number; capacity: number | null }>;
  recentEntries: Array<Record<string, unknown>>;
  totalCheckedIn: number;
  totalRegistered: number;
}) {
  const [qrInput, setQrInput] = useState("");
  const [selectedZone, setSelectedZone] = useState<string>("");
  const [scanResult, setScanResult] = useState<ScanResult>({ status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkinMutation = usePerformCheckin(eventId);

  // Auto-focus the input on mount and after each scan
  useEffect(() => {
    inputRef.current?.focus();
  }, [scanResult.status]);

  // Clear result after 4 seconds, ready for next scan
  const scheduleClear = useCallback(() => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => {
      setScanResult({ status: "idle" });
      setQrInput("");
      inputRef.current?.focus();
    }, 4000);
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  const handleCheckin = useCallback(async () => {
    const trimmed = qrInput.trim();
    if (!trimmed) return;

    setScanResult({ status: "loading" });

    try {
      const response = await checkinMutation.mutateAsync({
        qrCodeValue: trimmed,
        accessZoneId: selectedZone || undefined,
      });

      const data = (response as { data?: Record<string, unknown> })?.data as
        | Record<string, unknown>
        | undefined;

      setScanResult({
        status: "success",
        participantName: data?.participantName as string | null,
        ticketType: data?.ticketType as string | null,
        accessZone: data?.accessZone as string | null,
        checkedInAt: data?.checkedInAt as string | null,
      });

      toast.success("Check-in reussi !", {
        description: (data?.participantName as string) ?? "Participant enregistre",
      });

      scheduleClear();
    } catch (err: unknown) {
      const error = err as {
        code?: string;
        message?: string;
        status?: number;
        details?: Record<string, unknown>;
      };
      const code = error.code ?? "";
      const message = error.message ?? "Erreur inconnue";

      if (code === "QR_ALREADY_USED" || error.status === 409) {
        // Duplicate-scan enrichment (badge-journey-review 3.5). Pull the
        // scanner identity off `error.details` so the red card can show
        // "Déjà validé par Aminata" instead of a bare message.
        const d = error.details ?? {};
        setScanResult({
          status: "already_checked_in",
          errorMessage: message,
          checkedInAt: (d.checkedInAt as string | null | undefined) ?? null,
          checkedInBy: (d.checkedInBy as string | null | undefined) ?? null,
          checkedInByName: (d.checkedInByName as string | null | undefined) ?? null,
          checkedInDeviceId: (d.checkedInDeviceId as string | null | undefined) ?? null,
        });
        const toastDescription =
          d.checkedInByName && d.checkedInAt
            ? `Déjà validé par ${d.checkedInByName} · ${formatRelative(d.checkedInAt as string)}`
            : message;
        toast.warning("Déjà enregistré", { description: toastDescription });
      } else if (code === "QR_EXPIRED" || error.status === 410) {
        // Badge signed validity window is in the past. Surface as its own
        // state so staff can distinguish fraud attempts from scanner errors.
        setScanResult({ status: "expired", errorMessage: message });
        toast.error("Badge expiré", { description: message });
      } else if (code === "QR_NOT_YET_VALID" || error.status === 425) {
        // Trying to check in before the validity window opens — typically a
        // staff misconfiguration (wrong event date) or someone testing early.
        setScanResult({ status: "not_yet_valid", errorMessage: message });
        toast.warning("Badge pas encore valide", { description: message });
      } else {
        setScanResult({
          status: "error",
          errorMessage: message,
        });
        toast.error("Echec du check-in", { description: message });
      }

      scheduleClear();
    }
  }, [qrInput, selectedZone, checkinMutation, scheduleClear]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleCheckin();
      }
    },
    [handleCheckin],
  );

  // Find zone stats for selected zone
  const selectedZoneStats = selectedZone ? byZone.find((z) => z.zoneId === selectedZone) : null;

  const percentage = totalRegistered > 0 ? Math.round((totalCheckedIn / totalRegistered) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Mini stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-green-50 dark:bg-green-900/30 p-2 rounded-lg">
              <UserCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Entrees</p>
              <p className="text-lg font-bold text-foreground">
                {totalCheckedIn} / {totalRegistered}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-blue-50 dark:bg-blue-900/30 p-2 rounded-lg">
              <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Progression</p>
              <p className="text-lg font-bold text-foreground">{percentage}%</p>
            </div>
          </CardContent>
        </Card>
        {selectedZoneStats && (
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="bg-purple-50 dark:bg-purple-900/30 p-2 rounded-lg">
                <MapPin className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{selectedZoneStats.zoneName}</p>
                <p className="text-lg font-bold text-foreground">
                  {selectedZoneStats.checkedIn}
                  {selectedZoneStats.capacity ? ` / ${selectedZoneStats.capacity}` : ""}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Scanner Card */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            Scanner un badge
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Zone selector */}
          {accessZones.length > 0 && (
            <div>
              <label
                htmlFor="zone-select"
                className="block text-sm font-medium text-foreground mb-1.5"
              >
                Zone d&apos;acces
              </label>
              <Select
                id="zone-select"
                value={selectedZone}
                onChange={(e) => setSelectedZone(e.target.value)}
                className="max-w-sm"
              >
                <option value="">Toutes les zones</option>
                {accessZones.map((zone) => {
                  const zoneStats = byZone.find((z) => z.zoneId === zone.id);
                  const capacityLabel = zone.capacity
                    ? ` (${zoneStats?.checkedIn ?? 0}/${zone.capacity})`
                    : "";
                  return (
                    <option key={zone.id} value={zone.id}>
                      {zone.name}
                      {capacityLabel}
                    </option>
                  );
                })}
              </Select>
            </div>
          )}

          {/* QR Input */}
          <div>
            <label htmlFor="qr-input" className="block text-sm font-medium text-foreground mb-1.5">
              Code QR ou ID d&apos;inscription
            </label>
            <div className="flex gap-3">
              <Input
                ref={inputRef}
                id="qr-input"
                type="text"
                value={qrInput}
                onChange={(e) => setQrInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Scannez ou collez le code QR ici..."
                className="flex-1 h-14 text-lg px-4"
                disabled={scanResult.status === "loading"}
                autoComplete="off"
                autoFocus
              />
              <Button
                onClick={handleCheckin}
                disabled={!qrInput.trim() || scanResult.status === "loading"}
                className="h-14 px-6 text-base min-w-[120px]"
              >
                {scanResult.status === "loading" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Search className="h-5 w-5 mr-2" />
                    Verifier
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              Utilisez l&apos;appareil photo de votre telephone pour scanner le QR code, puis collez
              la valeur ici. Appuyez sur Entree pour valider.
            </p>
          </div>

          {/* Scan Result */}
          {scanResult.status !== "idle" && scanResult.status !== "loading" && (
            <ScanResultCard result={scanResult} />
          )}
        </CardContent>
      </Card>

      {/* Recent check-ins (mini) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" />
            Derniers check-ins
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentEntries.length === 0 ? (
            <EmptyState
              icon={UserCheck}
              title="Aucun check-in pour le moment"
              description="Les check-ins apparaîtront ici dès que vos participants arriveront."
              className="py-6"
            />
          ) : (
            <div className="space-y-1">
              {recentEntries.slice(0, 10).map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-2.5 px-2 rounded-md hover:bg-muted/50 border-b last:border-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    <span className="font-medium text-foreground truncate">
                      {(entry.participantName as string) ??
                        (entry.participantEmail as string) ??
                        "Inconnu"}
                    </span>
                    {(entry.ticketTypeName as string | undefined) ? (
                      <Badge variant="secondary" className="shrink-0 text-xs">
                        {entry.ticketTypeName as string}
                      </Badge>
                    ) : null}
                    {(entry.accessZoneName as string | undefined) ? (
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {entry.accessZoneName as string}
                      </Badge>
                    ) : null}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 ml-2">
                    {formatTime(entry.checkedInAt as string)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Scan Result Card ───────────────────────────────────────────────────────

function ScanResultCard({ result }: { result: ScanResult }) {
  if (result.status === "success") {
    return (
      <div className="rounded-xl border-2 border-green-500 bg-green-50 dark:bg-green-900/20 p-6 animate-in fade-in duration-300">
        <div className="flex items-start gap-4">
          <div className="bg-green-100 dark:bg-green-900/40 p-3 rounded-full">
            <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-green-800 dark:text-green-300">
              Check-in reussi
            </h3>
            {result.participantName && (
              <p className="text-lg font-semibold text-green-700 dark:text-green-400 mt-1">
                {result.participantName}
              </p>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              {result.ticketType && <Badge variant="success">{result.ticketType}</Badge>}
              {result.accessZone && <Badge variant="outline">{result.accessZone}</Badge>}
              {result.checkedInAt && (
                <span className="text-sm text-green-600 dark:text-green-400">
                  {formatTime(result.checkedInAt)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (result.status === "already_checked_in") {
    // Build the "scanned by who, when" subhead from the server-supplied
    // details. When both are present, give staff the full picture
    // ("Aminata Fall · il y a 12 s") so they can call across the aisle
    // rather than treat it as a fraud signal by default.
    const scannedByLine =
      result.checkedInByName && result.checkedInAt
        ? `${result.checkedInByName} · ${formatRelative(result.checkedInAt)}`
        : (result.checkedInByName ??
          (result.checkedInAt ? formatRelative(result.checkedInAt) : null));
    return (
      <div className="rounded-xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-900/20 p-6 animate-in fade-in duration-300">
        <div className="flex items-start gap-4">
          <div className="bg-amber-100 dark:bg-amber-900/40 p-3 rounded-full">
            <AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-amber-800 dark:text-amber-300">
              Deja enregistre
            </h3>
            {scannedByLine && (
              <p className="text-base font-semibold text-amber-900 dark:text-amber-200 mt-1">
                Validé par {scannedByLine}
              </p>
            )}
            <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
              {result.errorMessage ?? "Ce badge a deja ete scanne"}
            </p>
            {result.checkedInDeviceId && (
              <p className="text-xs text-amber-600 dark:text-amber-500 mt-1 font-mono">
                Appareil : {result.checkedInDeviceId}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (result.status === "expired") {
    return (
      <div className="rounded-xl border-2 border-red-500 bg-red-50 dark:bg-red-900/20 p-6 animate-in fade-in duration-300">
        <div className="flex items-start gap-4">
          <div className="bg-red-100 dark:bg-red-900/40 p-3 rounded-full">
            <XCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-red-800 dark:text-red-300">Badge expiré</h3>
            <p className="text-sm text-red-700 dark:text-red-400 mt-1">
              {result.errorMessage ??
                "La fenêtre de validité de ce badge est dépassée. Refuser l’entrée."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (result.status === "not_yet_valid") {
    return (
      <div className="rounded-xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-900/20 p-6 animate-in fade-in duration-300">
        <div className="flex items-start gap-4">
          <div className="bg-amber-100 dark:bg-amber-900/40 p-3 rounded-full">
            <AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-amber-800 dark:text-amber-300">
              Badge pas encore valide
            </h3>
            <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
              {result.errorMessage ??
                "Ce badge ne sera valide qu’à l’ouverture des portes de l’événement."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (result.status === "error") {
    return (
      <div className="rounded-xl border-2 border-red-500 bg-red-50 dark:bg-red-900/20 p-6 animate-in fade-in duration-300">
        <div className="flex items-start gap-4">
          <div className="bg-red-100 dark:bg-red-900/40 p-3 rounded-full">
            <XCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-red-800 dark:text-red-300">Echec du check-in</h3>
            <p className="text-sm text-red-700 dark:text-red-400 mt-1">
              {result.errorMessage ?? "QR code invalide"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Dashboard Tab ──────────────────────────────────────────────────────────

function DashboardTab({
  eventId,
  totalRegistered,
  totalCheckedIn,
  totalPending,
  percentage,
  lastCheckinAt,
  byZone,
  byTicketType,
  recentEntries,
}: {
  eventId: string;
  totalRegistered: number;
  totalCheckedIn: number;
  totalPending: number;
  percentage: number;
  lastCheckinAt: string | null;
  byZone: Array<{ zoneId: string; zoneName: string; checkedIn: number; capacity: number | null }>;
  byTicketType: Array<{
    ticketTypeId: string;
    ticketTypeName: string;
    registered: number;
    checkedIn: number;
  }>;
  recentEntries: Array<Record<string, unknown>>;
}) {
  return (
    <div>
      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon={<Users className="h-5 w-5 text-blue-600" />}
          label="Inscrits"
          value={String(totalRegistered)}
          bgColor="bg-blue-50 dark:bg-blue-900/30"
        />
        <StatCard
          icon={<UserCheck className="h-5 w-5 text-green-600" />}
          label="Entrees"
          value={`${totalCheckedIn} (${percentage}%)`}
          bgColor="bg-green-50 dark:bg-green-900/30"
        />
        <StatCard
          icon={<Clock className="h-5 w-5 text-yellow-600" />}
          label="En attente"
          value={String(totalPending)}
          bgColor="bg-yellow-50 dark:bg-yellow-900/30"
        />
        <StatCard
          icon={<Clock className="h-5 w-5 text-purple-600" />}
          label="Dernier check-in"
          value={lastCheckinAt ? formatTime(lastCheckinAt) : "\u2014"}
          bgColor="bg-purple-50 dark:bg-purple-900/30"
        />
      </div>

      {/* Progress bar */}
      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">Progression globale</span>
            <span className="text-sm font-bold text-foreground">{percentage}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-4">
            <div
              className="bg-green-500 h-4 rounded-full transition-all duration-500"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {totalCheckedIn} / {totalRegistered} participants
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Zone capacity */}
        {byZone.length > 0 && (
          <Card>
            <CardContent className="p-6">
              <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <MapPin className="h-5 w-5" /> Zones d&apos;acces
              </h2>
              <div className="space-y-4">
                {byZone.map((zone) => {
                  const zonePercent = zone.capacity
                    ? Math.round((zone.checkedIn / zone.capacity) * 100)
                    : null;
                  return (
                    <div key={zone.zoneId}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-foreground">{zone.zoneName}</span>
                        <span className="text-sm text-muted-foreground">
                          {zone.checkedIn}
                          {zone.capacity ? ` / ${zone.capacity}` : ""}
                        </span>
                      </div>
                      {zone.capacity && (
                        <div className="w-full bg-muted rounded-full h-2">
                          <div
                            className={`h-2 rounded-full transition-all ${zonePercent! >= 90 ? "bg-red-500" : zonePercent! >= 70 ? "bg-yellow-500" : "bg-blue-500"}`}
                            style={{ width: `${Math.min(zonePercent!, 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* By ticket type */}
        {byTicketType.length > 0 && (
          <Card>
            <CardContent className="p-6">
              <h2 className="text-lg font-semibold text-foreground mb-4">Par type de billet</h2>
              <DataTable<Record<string, unknown>>
                aria-label="Statistiques par type de billet"
                data={byTicketType as unknown as Record<string, unknown>[]}
                columns={
                  [
                    {
                      key: "ticketTypeName",
                      header: "Type",
                      primary: true,
                      render: (tt) => (
                        <span className="font-medium">{tt.ticketTypeName as string}</span>
                      ),
                    },
                    {
                      key: "registered",
                      header: "Inscrits",
                      render: (tt) => (tt.registered as number) ?? 0,
                    },
                    {
                      key: "checkedIn",
                      header: "Entrees",
                      render: (tt) => (tt.checkedIn as number) ?? 0,
                    },
                    {
                      key: "pct",
                      header: "%",
                      render: (tt) => {
                        const reg = (tt.registered as number) ?? 0;
                        const ci = (tt.checkedIn as number) ?? 0;
                        return `${reg > 0 ? Math.round((ci / reg) * 100) : 0}%`;
                      },
                    },
                  ] as DataTableColumn<Record<string, unknown>>[]
                }
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Recent check-ins feed */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <History className="h-5 w-5" /> Check-ins recents
            </h2>
            <Link
              href={`/events/${eventId}/checkin/history`}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              Voir tout
            </Link>
          </div>

          {recentEntries.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Aucun check-in pour le moment</p>
          ) : (
            <div className="space-y-2">
              {recentEntries.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <div>
                    <span className="font-medium text-foreground">
                      {(entry.participantName as string) ??
                        (entry.participantEmail as string) ??
                        "Inconnu"}
                    </span>
                    <span className="text-muted-foreground mx-2">-</span>
                    <span className="text-sm text-muted-foreground">
                      {entry.ticketTypeName as string}
                    </span>
                    {entry.accessZoneName ? (
                      <span className="ml-2 text-xs bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-0.5 rounded-full">
                        {entry.accessZoneName as string}
                      </span>
                    ) : null}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatTime(entry.checkedInAt as string)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Shared Components ──────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  bgColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  bgColor: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`${bgColor} p-2 rounded-lg`}>{icon}</div>
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-xl font-bold text-foreground">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
