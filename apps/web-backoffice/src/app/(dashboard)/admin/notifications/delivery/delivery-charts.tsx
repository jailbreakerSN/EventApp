"use client";

// ─── Delivery observability charts (Phase D.3) ───────────────────────────
// Chart primitives used by the super-admin observability dashboard and
// the per-key drill-down. Each component is pure (props in, chart out) so
// it can be fed static fixtures from Storybook and RTL tests, and so the
// shared styling (Teranga palette, responsive containers, WCAG-AA
// contrast) lives in one place.
//
// Why local to the admin surface and not in `packages/shared-ui`?
//   - These charts bake in the delivery-dashboard data contract. Promoting
//     them to shared-ui would mean importing a web-backoffice-specific
//     type into the shared package, which we don't do.
//   - The palette still comes from the shared Tailwind preset (hsl vars
//     below resolve to shared tokens in every theme).

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  AdminDeliveryDashboardBucket,
  AdminDeliveryDashboardPerChannel,
  AdminDeliveryDashboardTotals,
} from "@/lib/api-client";

// Teranga palette tokens. Keep these aligned with AdminPlanDashboard.tsx —
// the admin surface is small and consistency across panels matters more
// than per-chart palette flex.
export const CHART_COLORS = {
  sent: "hsl(var(--teranga-navy))",
  delivered: "hsl(var(--teranga-green))",
  displayed: "hsl(var(--teranga-green))",
  opened: "hsl(var(--teranga-gold))",
  clicked: "hsl(var(--primary))",
  suppressed: "hsl(var(--muted-foreground))",
  bounced: "hsl(var(--destructive))",
  complained: "hsl(var(--teranga-clay-dark, var(--destructive)))",
  dedup: "hsl(var(--teranga-clay, var(--muted-foreground)))",
} as const;

// ─── Time-series stacked area ────────────────────────────────────────────

export interface DeliveryTimeseriesChartProps {
  data: AdminDeliveryDashboardBucket[];
  granularity: "hour" | "day";
  /** Controls label for screen-readers + container aria-label. */
  title: string;
}

/**
 * Stacked area chart of sent / delivered / displayed / suppressed buckets
 * over time. Uses UTC ISO bucket labels truncated to the requested
 * granularity for axis ticks — we do NOT call `new Date()` inside the
 * tick formatter to avoid server/client hydration mismatches on a Next.js
 * SSR render.
 */
export function DeliveryTimeseriesChart({
  data,
  granularity,
  title,
}: DeliveryTimeseriesChartProps) {
  if (data.length === 0) {
    return (
      <EmptyChart
        label="Aucune activité sur la fenêtre sélectionnée."
        title={title}
      />
    );
  }
  return (
    <div role="img" aria-label={title} className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="bucket"
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
            tickFormatter={(v: string) => formatBucketTick(v, granularity)}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
            allowDecimals={false}
          />
          <RTooltip
            formatter={(value: number, name: string) => [value, labelFor(name)]}
            labelFormatter={(v: string) => formatBucketTick(v, granularity)}
          />
          <Legend
            formatter={(name: string) => (
              <span className="text-xs text-muted-foreground">{labelFor(name)}</span>
            )}
          />
          <Area
            type="monotone"
            dataKey="sent"
            stackId="1"
            stroke={CHART_COLORS.sent}
            fill={CHART_COLORS.sent}
            fillOpacity={0.45}
          />
          <Area
            type="monotone"
            dataKey="delivered"
            stackId="1"
            stroke={CHART_COLORS.delivered}
            fill={CHART_COLORS.delivered}
            fillOpacity={0.55}
          />
          <Area
            type="monotone"
            dataKey="pushDisplayed"
            stackId="1"
            stroke={CHART_COLORS.displayed}
            fill={CHART_COLORS.displayed}
            fillOpacity={0.35}
          />
          <Area
            type="monotone"
            dataKey="suppressed"
            stackId="1"
            stroke={CHART_COLORS.suppressed}
            fill={CHART_COLORS.suppressed}
            fillOpacity={0.35}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Per-channel stacked bar ──────────────────────────────────────────────

export interface PerChannelBarChartProps {
  data: AdminDeliveryDashboardPerChannel[];
  title: string;
}

export function PerChannelBarChart({ data, title }: PerChannelBarChartProps) {
  if (data.length === 0) {
    return <EmptyChart label="Aucun canal actif sur la fenêtre." title={title} />;
  }
  return (
    <div role="img" aria-label={title} className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data.map((row) => ({
            channel: row.channel,
            sent: Math.max(row.sent - row.suppressed, 0),
            suppressed: row.suppressed,
            successRate: row.successRate,
          }))}
          margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="channel" stroke="hsl(var(--muted-foreground))" fontSize={12} />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={11}
            allowDecimals={false}
          />
          <RTooltip
            formatter={(value: number, name: string) => [value, labelFor(name)]}
          />
          <Legend
            formatter={(name: string) => (
              <span className="text-xs text-muted-foreground">{labelFor(name)}</span>
            )}
          />
          <Bar dataKey="sent" stackId="channels" fill={CHART_COLORS.sent} />
          <Bar dataKey="suppressed" stackId="channels" fill={CHART_COLORS.suppressed} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Suppression donut ────────────────────────────────────────────────────

export interface SuppressionDonutProps {
  totals: AdminDeliveryDashboardTotals["suppressed"];
  title: string;
}

const SUPPRESSION_PALETTE: Record<
  keyof AdminDeliveryDashboardTotals["suppressed"],
  string
> = {
  admin_disabled: "hsl(var(--muted-foreground))",
  user_opted_out: CHART_COLORS.suppressed,
  on_suppression_list: CHART_COLORS.dedup,
  no_recipient: "hsl(var(--muted-foreground) / 0.7)",
  rate_limited: CHART_COLORS.opened,
  deduplicated: CHART_COLORS.dedup,
  bounced: CHART_COLORS.bounced,
  complained: CHART_COLORS.complained,
};

export function SuppressionDonut({ totals, title }: SuppressionDonutProps) {
  const entries = (Object.entries(totals) as Array<
    [keyof AdminDeliveryDashboardTotals["suppressed"], number]
  >).filter(([, v]) => v > 0);

  if (entries.length === 0) {
    return <EmptyChart label="Aucune suppression sur la fenêtre." title={title} />;
  }

  return (
    <div role="img" aria-label={title} className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={entries.map(([name, value]) => ({ name, value }))}
            dataKey="value"
            nameKey="name"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
          >
            {entries.map(([name]) => (
              <Cell key={name} fill={SUPPRESSION_PALETTE[name]} />
            ))}
          </Pie>
          <RTooltip
            formatter={(value: number, name: string) => [value, labelFor(name)]}
          />
          <Legend
            formatter={(name: string) => (
              <span className="text-xs text-muted-foreground">{labelFor(name)}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Funnel (per-key drill-down) ──────────────────────────────────────────

export interface DeliveryFunnelChartProps {
  totals: AdminDeliveryDashboardTotals;
  /** "email" funnel: sent → delivered → opened → clicked.
   *  "push" funnel: sent → pushDisplayed → pushClicked. */
  kind: "email" | "push";
  title: string;
}

export function DeliveryFunnelChart({ totals, kind, title }: DeliveryFunnelChartProps) {
  // Funnel rendered as horizontal bars with explicit magnitude labels.
  // Recharts has no first-class funnel chart; stacking horizontal bars is
  // the simplest accessible representation and matches how the ops team
  // already reads the delivery log.
  const stages =
    kind === "email"
      ? [
          { label: "Envoyés", value: totals.sent + totals.delivered + totals.opened + totals.clicked, color: CHART_COLORS.sent },
          { label: "Livrés", value: totals.delivered + totals.opened + totals.clicked, color: CHART_COLORS.delivered },
          { label: "Ouverts", value: totals.opened + totals.clicked, color: CHART_COLORS.opened },
          { label: "Cliqués", value: totals.clicked, color: CHART_COLORS.clicked },
        ]
      : [
          { label: "Envoyés", value: totals.sent + totals.pushDisplayed, color: CHART_COLORS.sent },
          { label: "Affichés", value: totals.pushDisplayed, color: CHART_COLORS.displayed },
          { label: "Cliqués", value: totals.pushClicked, color: CHART_COLORS.clicked },
        ];

  const max = Math.max(1, ...stages.map((s) => s.value));

  return (
    <div role="img" aria-label={title} className="space-y-3">
      {stages.map((stage, idx) => {
        const pct = Math.round((stage.value / max) * 100);
        return (
          <div key={stage.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">
                {idx + 1}. {stage.label}
              </span>
              <span className="font-mono text-muted-foreground">
                {stage.value.toLocaleString("fr-FR")}
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full transition-[width]"
                style={{ width: `${pct}%`, backgroundColor: stage.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Utility helpers ──────────────────────────────────────────────────────

function EmptyChart({ label, title }: { label: string; title: string }) {
  return (
    <div
      role="img"
      aria-label={title}
      className="flex h-64 w-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground"
    >
      {label}
    </div>
  );
}

function formatBucketTick(iso: string, granularity: "hour" | "day"): string {
  // Best-effort display — falls back to raw ISO if the input is malformed.
  // Guarded behind a try/catch because a bad ISO from the backend should
  // not 500 the chart.
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    if (granularity === "hour") {
      return new Intl.DateTimeFormat("fr-FR", {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
      }).format(d);
    }
    return new Intl.DateTimeFormat("fr-FR", {
      month: "short",
      day: "2-digit",
    }).format(d);
  } catch {
    return iso;
  }
}

function labelFor(key: string): string {
  const map: Record<string, string> = {
    sent: "Envoyés",
    delivered: "Livrés",
    opened: "Ouverts",
    clicked: "Cliqués",
    pushDisplayed: "Push affichés",
    pushClicked: "Push cliqués",
    suppressed: "Supprimés",
    admin_disabled: "Désactivée admin",
    user_opted_out: "Désabonnement utilisateur",
    on_suppression_list: "Liste de suppression",
    no_recipient: "Pas de destinataire",
    rate_limited: "Rate-limit",
    deduplicated: "Dédupliqués",
    bounced: "Rebond",
    complained: "Plainte",
    successRate: "Taux de succès",
  };
  return map[key] ?? key;
}
