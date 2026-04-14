"use client";

import { useState } from "react";
import { useOrgAnalytics } from "@/hooks/use-organization";
import { EmptyState, DataTable, type DataTableColumn } from "@teranga/shared-ui";
import { BarChart3, TrendingUp, Users, Ticket, CalendarCheck, Loader2 } from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import type { AnalyticsTimeframe } from "@teranga/shared-types";
import { PlanGate } from "@/components/plan/PlanGate";

const TIMEFRAME_OPTIONS: { value: AnalyticsTimeframe; label: string }[] = [
  { value: "7d", label: "7 jours" },
  { value: "30d", label: "30 jours" },
  { value: "90d", label: "90 jours" },
  { value: "12m", label: "12 mois" },
  { value: "all", label: "Tout" },
];

const PIE_COLORS = [
  "#1A1A2E",
  "#D4AF37",
  "#2E8B57",
  "#4169E1",
  "#FF6347",
  "#9370DB",
  "#20B2AA",
  "#FF8C00",
];

export default function AnalyticsPage() {
  const [timeframe, setTimeframe] = useState<AnalyticsTimeframe>("30d");
  const { data, isLoading } = useOrgAnalytics({ timeframe });

  const analytics = data?.data;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Analytiques</h1>
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {TIMEFRAME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTimeframe(opt.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                timeframe === opt.value
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !analytics ? (
        <div className="bg-card rounded-xl border border-border p-8">
          <EmptyState
            icon={BarChart3}
            title="Aucune donnée analytique"
            description="Aucune donnée analytique disponible."
          />
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard
              icon={<CalendarCheck className="h-5 w-5 text-blue-600" />}
              label="Événements"
              value={analytics.summary.totalEvents}
              bgColor="bg-blue-50"
            />
            <StatCard
              icon={<Users className="h-5 w-5 text-purple-600" />}
              label="Inscriptions"
              value={analytics.summary.totalRegistrations}
              bgColor="bg-purple-50"
            />
            <StatCard
              icon={<Ticket className="h-5 w-5 text-green-600" />}
              label="Check-ins"
              value={analytics.summary.totalCheckedIn}
              bgColor="bg-green-50"
            />
            <StatCard
              icon={<TrendingUp className="h-5 w-5 text-orange-600" />}
              label="Taux de check-in"
              value={`${Math.round(analytics.summary.checkinRate * 100)}%`}
              bgColor="bg-orange-50"
            />
          </div>

          {/* Charts row — gated behind advancedAnalytics */}
          <PlanGate feature="advancedAnalytics" fallback="blur">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Registrations over time */}
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">Inscriptions</h3>
                {analytics.registrationsOverTime.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={analytics.registrationsOverTime}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(d) => d.slice(5)}
                      />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip
                        labelFormatter={(d) => `Date: ${d}`}
                        contentStyle={{
                          fontSize: 12,
                          borderRadius: 8,
                          border: "1px solid #e5e7eb",
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        name="Inscriptions"
                        stroke="#1A1A2E"
                        fill="#1A1A2E"
                        fillOpacity={0.1}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState
                    title="Aucune inscription"
                    description="Aucune inscription sur cette période"
                  />
                )}
              </div>

              {/* Check-ins over time */}
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">Check-ins</h3>
                {analytics.checkinsOverTime.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={analytics.checkinsOverTime}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(d) => d.slice(5)}
                      />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip
                        labelFormatter={(d) => `Date: ${d}`}
                        contentStyle={{
                          fontSize: 12,
                          borderRadius: 8,
                          border: "1px solid #e5e7eb",
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        name="Check-ins"
                        stroke="#2E8B57"
                        fill="#2E8B57"
                        fillOpacity={0.1}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState
                    title="Aucun check-in"
                    description="Aucun check-in sur cette période"
                  />
                )}
              </div>
            </div>

            {/* Bottom row: Category breakdown + Top events */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* By category */}
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">Par catégorie</h3>
                {analytics.byCategory.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={analytics.byCategory}
                        dataKey="count"
                        nameKey="category"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={({ category, count }) => `${category} (${count})`}
                        labelLine={false}
                      >
                        {analytics.byCategory.map((_, index) => (
                          <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState
                    title="Aucune donnée"
                    description="Aucune donnée de catégorie disponible"
                  />
                )}
              </div>

              {/* By ticket type */}
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">Par type de billet</h3>
                {analytics.byTicketType.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={analytics.byTicketType}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="ticketTypeName" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Bar
                        dataKey="registered"
                        name="Inscrits"
                        fill="#1A1A2E"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="checkedIn"
                        name="Check-ins"
                        fill="#D4AF37"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState
                    title="Aucune donnée"
                    description="Aucune donnée de billets disponible"
                  />
                )}
              </div>
            </div>

            {/* Top events */}
            {analytics.topEvents.length > 0 && (
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">Top événements</h3>
                <DataTable<(typeof analytics.topEvents)[number] & Record<string, unknown>>
                  aria-label="Top événements"
                  data={
                    analytics.topEvents as ((typeof analytics.topEvents)[number] &
                      Record<string, unknown>)[]
                  }
                  columns={
                    [
                      {
                        key: "title",
                        header: "Événement",
                        primary: true,
                        render: (e) => (
                          <span className="font-medium text-foreground">{e.title}</span>
                        ),
                      },
                      {
                        key: "registeredCount",
                        header: "Inscrits",
                        render: (e) => (
                          <span className="text-muted-foreground">{e.registeredCount}</span>
                        ),
                      },
                      {
                        key: "checkedInCount",
                        header: "Check-ins",
                        render: (e) => (
                          <span className="text-muted-foreground">{e.checkedInCount}</span>
                        ),
                      },
                      {
                        key: "rate",
                        header: "Taux",
                        render: (e) => {
                          const rate =
                            e.registeredCount > 0
                              ? Math.round((e.checkedInCount / e.registeredCount) * 100)
                              : 0;
                          return (
                            <span
                              className={`text-xs font-medium ${rate >= 70 ? "text-teranga-green" : rate >= 40 ? "text-teranga-gold-dark" : "text-muted-foreground"}`}
                            >
                              {rate}%
                            </span>
                          );
                        },
                      },
                    ] as DataTableColumn<
                      (typeof analytics.topEvents)[number] & Record<string, unknown>
                    >[]
                  }
                />
              </div>
            )}
          </PlanGate>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  bgColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  bgColor: string;
}) {
  return (
    <div className="bg-card rounded-xl p-5 shadow-sm border border-border">
      <div className="flex items-center gap-3 mb-3">
        <div className={`${bgColor} p-2 rounded-lg`}>{icon}</div>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
      <p className="text-3xl font-bold text-primary">{value}</p>
    </div>
  );
}
