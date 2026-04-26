"use client";

/**
 * Organizer overhaul — Phase O9.
 *
 * 4-card stack summarising the post-event snapshot: attendance,
 * comms performance, financial summary, demographic top lists. The
 * page composes them in order; each card is presentational and
 * accepts its slice of the report directly so the cards can be
 * re-used in the dashboard widget area later if needed.
 *
 * Each card stays compact (≤ 6 KPI rows) so the whole report fits
 * above the fold on a 13" laptop — the operator's most common
 * day-after-event device.
 */

import { CheckCircle2, CircleSlash, Coins, Megaphone, Users, Sparkles } from "lucide-react";
import { Card, CardContent, Skeleton } from "@teranga/shared-ui";
import { cn } from "@/lib/utils";
import { formatXof } from "./helpers";
import type {
  AttendanceBreakdown,
  BreakdownRow,
  CommsPerformance,
  FinancialSummary,
  PostEventReport,
} from "@teranga/shared-types";

export function PostEventReportCards({
  report,
  isLoading,
}: {
  report: PostEventReport | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} variant="rectangle" className="h-44" />
        ))}
      </div>
    );
  }
  if (!report) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Pas encore de données pour cet événement.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <AttendanceCard data={report.attendance} isFinal={report.isFinal} />
      <CommsCard data={report.comms} />
      <FinancialCard data={report.financial} />
      <DemographicsCard
        ticketTop={report.demographics.byTicketType.slice(0, 5)}
        zoneTop={report.demographics.byAccessZone.slice(0, 5)}
        languageTop={report.demographics.byLanguage}
      />
    </div>
  );
}

// ─── Cards ────────────────────────────────────────────────────────────────

function AttendanceCard({ data, isFinal }: { data: AttendanceBreakdown; isFinal: boolean }) {
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <header className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-teranga-gold" aria-hidden="true" />
            Présence
          </h3>
          <span
            className={cn(
              "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full",
              isFinal
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
            )}
          >
            {isFinal ? "Final" : "En cours"}
          </span>
        </header>
        <div className="grid grid-cols-3 gap-2">
          <KpiTile label="Inscrits" value={String(data.registered)} />
          <KpiTile
            label="Présents"
            value={String(data.checkedIn)}
            sub={`${data.checkinRatePercent}%`}
          />
          <KpiTile
            label={isFinal ? "No-show" : "Pas encore"}
            value={isFinal ? String(data.noShow) : "—"}
            tone="muted"
          />
        </div>
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <CircleSlash className="h-3 w-3" aria-hidden="true" />
          {data.cancelled} annulation{data.cancelled === 1 ? "" : "s"}
        </p>
      </CardContent>
    </Card>
  );
}

function CommsCard({ data }: { data: CommsPerformance }) {
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <header className="flex items-center gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-teranga-gold" aria-hidden="true" />
            Communications
          </h3>
        </header>
        <div className="grid grid-cols-3 gap-2">
          <KpiTile label="Diffusions" value={String(data.broadcastsSent)} />
          <KpiTile label="Destinataires" value={String(data.totalRecipients)} />
          <KpiTile
            label="Échecs"
            value={String(data.totalFailed)}
            tone={data.totalFailed > 0 ? "warning" : "default"}
          />
        </div>
        {data.perChannel.length > 0 ? (
          <BreakdownList rows={data.perChannel} />
        ) : (
          <p className="text-[11px] text-muted-foreground">Aucune diffusion envoyée.</p>
        )}
      </CardContent>
    </Card>
  );
}

function FinancialCard({ data }: { data: FinancialSummary }) {
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <header className="flex items-center gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Coins className="h-4 w-4 text-teranga-gold" aria-hidden="true" />
            Finances
          </h3>
        </header>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Row label="Brut" value={formatXof(data.grossAmount)} />
          <Row label="Remboursements" value={formatXof(data.refundedAmount)} />
          <Row label="Frais plateforme" value={formatXof(data.platformFee)} />
          <Row label="Net à verser" value={formatXof(data.payoutAmount)} bold />
        </dl>
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <CheckCircle2
            className="h-3 w-3 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          {data.paidRegistrations} inscription{data.paidRegistrations === 1 ? "" : "s"} payante
          {data.paidRegistrations === 1 ? "" : "s"}
        </p>
      </CardContent>
    </Card>
  );
}

function DemographicsCard({
  ticketTop,
  zoneTop,
  languageTop,
}: {
  ticketTop: BreakdownRow[];
  zoneTop: BreakdownRow[];
  languageTop: BreakdownRow[];
}) {
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <header className="flex items-center gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-teranga-gold" aria-hidden="true" />
            Répartition
          </h3>
        </header>
        <div className="grid gap-3 sm:grid-cols-2">
          <SubBreakdown title="Types de billets" rows={ticketTop} />
          <SubBreakdown title="Zones d'accès" rows={zoneTop} />
        </div>
        {languageTop.length > 0 && <SubBreakdown title="Langues préférées" rows={languageTop} />}
      </CardContent>
    </Card>
  );
}

// ─── Atoms ────────────────────────────────────────────────────────────────

function KpiTile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warning" | "muted";
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border p-2",
        tone === "warning" && "bg-amber-50/60 dark:bg-amber-950/30",
      )}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-xl font-semibold tabular-nums",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm tabular-nums text-right", bold && "font-semibold")}>{value}</dd>
    </>
  );
}

function SubBreakdown({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <BreakdownList rows={rows} />
      )}
    </div>
  );
}

function BreakdownList({ rows }: { rows: BreakdownRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="space-y-1">
      {rows.map((r) => {
        const pct = Math.round((r.count / max) * 100);
        return (
          <li key={r.key} className="flex items-center gap-2 text-xs">
            <span className="flex-1 truncate text-foreground">{r.label}</span>
            <span aria-hidden="true" className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
              <span className="block h-full bg-teranga-gold/70" style={{ width: `${pct}%` }} />
            </span>
            <span className="text-muted-foreground tabular-nums w-8 text-right">{r.count}</span>
          </li>
        );
      })}
    </ul>
  );
}
