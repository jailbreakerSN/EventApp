"use client";

/**
 * Phase D.3 super-admin delivery observability dashboard.
 *
 * Cross-tenant view of the notificationDispatchLog backed by the
 * GET /v1/admin/notifications/delivery endpoint. The page surfaces:
 *
 *   - Four KPI summary cards (total sent, delivery rate, CTR, bounce rate).
 *   - Per-channel stacked bar.
 *   - Time-series stacked area (sent / delivered / displayed / suppressed).
 *   - Suppression breakdown donut.
 *   - CSV export of the current slice.
 *
 * Access control: the parent `admin/layout.tsx` gates the whole admin
 * surface behind super_admin. We still send the auth header and trust
 * the API's `platform:manage` check as the authoritative boundary.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Download,
  Gauge,
  Send,
  TrendingUp,
} from "lucide-react";
import {
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  InlineErrorBanner,
  SectionHeader,
  Select,
  Skeleton,
} from "@teranga/shared-ui";
import { useAdminDeliveryDashboard } from "@/hooks/use-admin-notifications";
import {
  DeliveryTimeseriesChart,
  PerChannelBarChart,
  SuppressionDonut,
} from "./delivery-charts";
import type { AdminDeliveryDashboardResponse } from "@/lib/api-client";

// ─── Constants ───────────────────────────────────────────────────────────

const WINDOW_OPTIONS: Array<{ days: number; key: "day" | "week" | "month" }> = [
  { days: 1, key: "day" },
  { days: 7, key: "week" },
  { days: 30, key: "month" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────

function percentFormatter(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function safeDivide(numer: number, denom: number): number {
  if (!Number.isFinite(numer) || !Number.isFinite(denom) || denom === 0) return 0;
  return numer / denom;
}

function computeKpis(data: AdminDeliveryDashboardResponse) {
  const { totals } = data;
  // "Reach" denominator — every non-suppressed, non-dedup attempt the
  // dispatcher handed off to a provider. Sum of the email funnel + push
  // baseline. Used as the denom for delivery & CTR so the numbers match
  // the per-channel bar chart.
  const reach =
    totals.sent +
    totals.delivered +
    totals.opened +
    totals.clicked +
    totals.pushDisplayed;

  const deliveryRate = safeDivide(
    totals.delivered + totals.opened + totals.clicked + totals.pushDisplayed,
    reach,
  );

  const clickRate = safeDivide(totals.clicked + totals.pushClicked, reach);

  const bounceDenom =
    reach + totals.suppressed.bounced + totals.suppressed.complained;
  const bounceRate = safeDivide(
    totals.suppressed.bounced + totals.suppressed.complained,
    bounceDenom,
  );

  return {
    totalSent: reach,
    deliveryRate,
    clickRate,
    bounceRate,
  };
}

function buildCsv(data: AdminDeliveryDashboardResponse): string {
  const rows: string[] = [];
  rows.push("section,metric,value");
  rows.push(`range,from,${data.range.from}`);
  rows.push(`range,to,${data.range.to}`);
  rows.push(`range,granularity,${data.range.granularity}`);
  rows.push(`totals,sent,${data.totals.sent}`);
  rows.push(`totals,delivered,${data.totals.delivered}`);
  rows.push(`totals,opened,${data.totals.opened}`);
  rows.push(`totals,clicked,${data.totals.clicked}`);
  rows.push(`totals,pushDisplayed,${data.totals.pushDisplayed}`);
  rows.push(`totals,pushClicked,${data.totals.pushClicked}`);
  for (const [reason, count] of Object.entries(data.totals.suppressed)) {
    rows.push(`suppressed,${reason},${count}`);
  }
  rows.push("");
  rows.push("channel,sent,suppressed,successRate");
  for (const row of data.perChannel) {
    rows.push(
      `${row.channel},${row.sent},${row.suppressed},${row.successRate.toFixed(4)}`,
    );
  }
  rows.push("");
  rows.push("bucket,sent,delivered,opened,clicked,pushDisplayed,pushClicked,suppressed");
  for (const b of data.timeseries) {
    rows.push(
      `${b.bucket},${b.sent},${b.delivered},${b.opened},${b.clicked},${b.pushDisplayed},${b.pushClicked},${b.suppressed}`,
    );
  }
  return rows.join("\n");
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function AdminNotificationsDeliveryPage() {
  const t = useTranslations("admin.notifications.delivery");
  const tChartLabels = useTranslations("admin.notifications.delivery.chartLabels");
  const [windowDays, setWindowDays] = useState<number>(7);

  // Build the localised label maps up front. These are stable per render
  // of the page and passed down to the chart primitives so the charts
  // themselves stay locale-agnostic.
  const chartLabels = useMemo<Record<string, string>>(
    () => ({
      sent: tChartLabels("sent"),
      delivered: tChartLabels("delivered"),
      opened: tChartLabels("opened"),
      clicked: tChartLabels("clicked"),
      pushDisplayed: tChartLabels("pushDisplayed"),
      pushClicked: tChartLabels("pushClicked"),
      suppressed: tChartLabels("suppressed"),
      admin_disabled: tChartLabels("admin_disabled"),
      user_opted_out: tChartLabels("user_opted_out"),
      on_suppression_list: tChartLabels("on_suppression_list"),
      no_recipient: tChartLabels("no_recipient"),
      rate_limited: tChartLabels("rate_limited"),
      deduplicated: tChartLabels("deduplicated"),
      bounced: tChartLabels("bounced"),
      complained: tChartLabels("complained"),
      successRate: tChartLabels("successRate"),
    }),
    [tChartLabels],
  );

  // Compute from/to as ISO strings so the query key is stable for the
  // whole session window. We do NOT include `new Date()` at render time
  // in the query key (would force a refetch every render); React Query's
  // 60s staleTime caps the refresh cadence anyway.
  const { fromIso, toIso, granularity } = useMemo(() => {
    const now = new Date();
    const to = now.toISOString();
    const from = new Date(
      now.getTime() - windowDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const gran: "hour" | "day" = windowDays <= 1 ? "hour" : "day";
    return { fromIso: from, toIso: to, granularity: gran };
  }, [windowDays]);

  const query = useAdminDeliveryDashboard({
    from: fromIso,
    to: toIso,
    granularity,
  });

  const kpis = query.data ? computeKpis(query.data.data) : null;

  const handleExport = () => {
    if (!query.data) return;
    const csv = buildCsv(query.data.data);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `teranga-delivery-${stamp}.csv`);
  };

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/dashboard">{t("breadcrumbHome")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin">{t("breadcrumbAdmin")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin/notifications">{t("breadcrumbNotifications")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{t("breadcrumb")}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <SectionHeader
        kicker={t("kicker")}
        title={t("title")}
        subtitle={t("subtitle")}
        size="hero"
        as="h1"
      />

      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor="delivery-window-picker"
          className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
        >
          {t("window")}
        </label>
        <Select
          id="delivery-window-picker"
          value={String(windowDays)}
          onChange={(e) => setWindowDays(Number(e.target.value))}
          aria-label={t("windowAriaLabel")}
          className="max-w-xs"
        >
          {WINDOW_OPTIONS.map((opt) => (
            <option key={opt.days} value={opt.days}>
              {t(`windowOptions.${opt.key}`)}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={!query.data || query.isLoading}
            aria-label={t("exportAriaLabel")}
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("export")}
          </Button>
        </div>
      </div>

      {query.isError && (
        <InlineErrorBanner
          severity="error"
          kicker={t("errorKicker")}
          title={t("errorTitle")}
          description={
            query.error instanceof Error
              ? query.error.message
              : t("errorDescription")
          }
        />
      )}

      {query.isLoading && <DashboardSkeleton />}

      {query.data && !query.isLoading && kpis && (
        <DashboardBody
          data={query.data.data}
          kpis={kpis}
          granularity={granularity}
          chartLabels={chartLabels}
        />
      )}
    </div>
  );
}

// ─── Body ────────────────────────────────────────────────────────────────

function DashboardBody({
  data,
  kpis,
  granularity,
  chartLabels,
}: {
  data: AdminDeliveryDashboardResponse;
  kpis: {
    totalSent: number;
    deliveryRate: number;
    clickRate: number;
    bounceRate: number;
  };
  granularity: "hour" | "day";
  chartLabels: Record<string, string>;
}) {
  const t = useTranslations("admin.notifications.delivery");
  const highBounce = kpis.bounceRate > 0.05;
  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Send className="h-5 w-5 text-teranga-navy" />}
          label={t("kpi.totalSent")}
          value={kpis.totalSent.toLocaleString("fr-FR")}
          hint={t("kpi.totalSentHint")}
        />
        <KpiCard
          icon={<TrendingUp className="h-5 w-5 text-teranga-green" />}
          label={t("kpi.deliveryRate")}
          value={percentFormatter(kpis.deliveryRate)}
          hint={t("kpi.deliveryRateHint")}
        />
        <KpiCard
          icon={<Gauge className="h-5 w-5 text-teranga-gold" />}
          label={t("kpi.clickRate")}
          value={percentFormatter(kpis.clickRate)}
          hint={t("kpi.clickRateHint")}
        />
        <KpiCard
          icon={
            <AlertTriangle
              className={`h-5 w-5 ${
                highBounce ? "text-destructive" : "text-muted-foreground"
              }`}
            />
          }
          label={t("kpi.bounceRate")}
          value={percentFormatter(kpis.bounceRate)}
          hint={t("kpi.bounceRateHint")}
          tone={highBounce ? "destructive" : "default"}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("panels.perChannel")}</CardTitle>
          </CardHeader>
          <CardContent>
            <PerChannelBarChart
              data={data.perChannel}
              title={t("panels.perChannelTitle")}
              emptyLabel={t("emptyChannel")}
              labels={chartLabels}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("panels.suppression")}</CardTitle>
          </CardHeader>
          <CardContent>
            <SuppressionDonut
              totals={data.totals.suppressed}
              title={t("panels.suppressionTitle")}
              emptyLabel={t("emptySuppression")}
              labels={chartLabels}
            />
          </CardContent>
        </Card>
      </div>

      {/* Time-series spans full width */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>{t("panels.timeseries")}</CardTitle>
          <Badge variant="neutral" className="text-[10px]">
            {granularity === "hour" ? t("granularity.hour") : t("granularity.day")}
          </Badge>
        </CardHeader>
        <CardContent>
          <DeliveryTimeseriesChart
            data={data.timeseries}
            granularity={granularity}
            title={t("panels.timeseriesTitle")}
            emptyLabel={t("emptyChart")}
            labels={chartLabels}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("panels.focusOnKey")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t("focusBody.before")}
          <Link
            href="/admin/notifications"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("focusBody.link")}
          </Link>
          {t("focusBody.after")}
        </CardContent>
      </Card>
    </>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-2 p-4">
              <Skeleton variant="text" className="h-3 w-24" />
              <Skeleton variant="text" className="h-7 w-32" />
              <Skeleton variant="text" className="h-3 w-40" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton variant="rectangle" className="h-72 w-full rounded-lg" />
    </div>
  );
}

// ─── KPI card ────────────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "destructive";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
        </div>
        <p
          className={`mt-2 text-2xl font-bold ${
            tone === "destructive" ? "text-destructive" : "text-foreground"
          }`}
        >
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

