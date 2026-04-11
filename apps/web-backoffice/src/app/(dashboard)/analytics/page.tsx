"use client";

import { useState } from "react";
import { useOrgAnalytics } from "@/hooks/use-organization";
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
        <div className="bg-card rounded-xl border border-border p-8 text-center text-muted-foreground">
          <BarChart3 className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
          <p>Aucune donnée analytique disponible.</p>
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
                  <p className="text-sm text-muted-foreground py-10 text-center">
                    Aucune inscription sur cette période
                  </p>
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
                  <p className="text-sm text-muted-foreground py-10 text-center">
                    Aucun check-in sur cette période
                  </p>
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
                  <p className="text-sm text-muted-foreground py-10 text-center">Aucune donnée</p>
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
                  <p className="text-sm text-muted-foreground py-10 text-center">Aucune donnée</p>
                )}
              </div>
            </div>

            {/* Top events */}
            {analytics.topEvents.length > 0 && (
              <div className="bg-card rounded-xl border border-border p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">Top événements</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border">
                      <th className="text-left pb-2 font-medium">Événement</th>
                      <th className="text-right pb-2 font-medium">Inscrits</th>
                      <th className="text-right pb-2 font-medium">Check-ins</th>
                      <th className="text-right pb-2 font-medium">Taux</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.topEvents.map((event) => {
                      const rate =
                        event.registeredCount > 0
                          ? Math.round((event.checkedInCount / event.registeredCount) * 100)
                          : 0;
                      return (
                        <tr key={event.eventId} className="border-b border-border last:border-0">
                          <td className="py-2.5 font-medium text-foreground">{event.title}</td>
                          <td className="py-2.5 text-right text-muted-foreground">
                            {event.registeredCount}
                          </td>
                          <td className="py-2.5 text-right text-muted-foreground">
                            {event.checkedInCount}
                          </td>
                          <td className="py-2.5 text-right">
                            <span
                              className={`text-xs font-medium ${rate >= 70 ? "text-green-600" : rate >= 40 ? "text-yellow-600" : "text-muted-foreground"}`}
                            >
                              {rate}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
