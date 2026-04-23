"use client";

/**
 * Phase D.3 per-catalog-key drill-down.
 *
 * Scoped version of /admin/notifications/delivery — same charts, same
 * data contract, filtered server-side to one catalog key. Shows the
 * catalog entry's metadata at the top (displayName / category /
 * supportedChannels) so the admin always knows what they're inspecting,
 * plus an email + push funnel panel.
 *
 * Note: raw dispatch-log rows (the "last 20" table the spec mentions)
 * would need a new paginated endpoint. Phase D.3 surfaces pre-aggregated
 * metrics only — to avoid adding a PII-leaking cross-tenant raw-row read
 * path in the same PR. The drill-down links back to the catalog row for
 * the per-user history page, which already handles the PII redaction.
 */

import { useMemo } from "react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import {
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  InlineErrorBanner,
  SectionHeader,
  Skeleton,
} from "@teranga/shared-ui";
import {
  NOTIFICATION_CATALOG,
  type NotificationDefinition,
} from "@teranga/shared-types";
import { useAdminDeliveryDashboard } from "@/hooks/use-admin-notifications";
import {
  DeliveryFunnelChart,
  DeliveryTimeseriesChart,
  PerChannelBarChart,
  SuppressionDonut,
} from "../delivery-charts";

export default function AdminDeliveryByKeyPage() {
  const params = useParams<{ key: string }>();
  const rawKey = params?.key;
  const key = typeof rawKey === "string" ? decodeURIComponent(rawKey) : undefined;

  const definition = useMemo<NotificationDefinition | undefined>(() => {
    if (!key) return undefined;
    return NOTIFICATION_CATALOG.find((d) => d.key === key);
  }, [key]);

  // Compute a stable 7-day window (day granularity) — same reasoning as
  // the top-level page. Hour granularity is overkill when the volumes
  // are already partitioned by key.
  const { fromIso, toIso } = useMemo(() => {
    const now = new Date();
    return {
      fromIso: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      toIso: now.toISOString(),
    };
  }, []);

  const query = useAdminDeliveryDashboard(
    key ? { key, from: fromIso, to: toIso, granularity: "day" } : { from: fromIso, to: toIso, granularity: "day" },
  );

  if (!key) {
    notFound();
  }

  if (!definition) {
    // Unknown catalog key — render a helpful banner instead of crashing.
    // The API would return an empty aggregate; surface the client-side
    // guard first so admins don't chase a silent no-data state.
    return (
      <div className="space-y-6">
        <InlineErrorBanner
          severity="error"
          kicker="— Introuvable"
          title="Clé inconnue"
          description={`Aucune entrée « ${key} » dans le catalogue.`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin">Administration</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin/notifications">Notifications</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin/notifications/delivery">Observabilité</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{key}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <SectionHeader
        kicker="— DRILL-DOWN"
        title={definition.displayName.fr}
        subtitle={definition.description.fr}
        size="hero"
        as="h1"
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <code className="font-mono text-xs text-foreground">{key}</code>
          <Badge variant="neutral" className="text-[10px]">
            {definition.category}
          </Badge>
          <div className="flex flex-wrap gap-1">
            {definition.supportedChannels.map((ch) => (
              <Badge key={ch} variant="secondary" className="text-[10px]">
                {ch}
              </Badge>
            ))}
          </div>
          {!definition.userOptOutAllowed && (
            <Badge variant="destructive" className="text-[10px]">
              Obligatoire
            </Badge>
          )}
        </CardContent>
      </Card>

      {query.isError && (
        <InlineErrorBanner
          severity="error"
          kicker="— Erreur"
          title="Impossible de charger les données"
          description={
            query.error instanceof Error
              ? query.error.message
              : "Réessayez dans quelques instants."
          }
        />
      )}

      {query.isLoading && (
        <div className="space-y-4" aria-busy="true" aria-live="polite">
          <Skeleton variant="rectangle" className="h-24 w-full rounded-lg" />
          <Skeleton variant="rectangle" className="h-72 w-full rounded-lg" />
        </div>
      )}

      {query.data && !query.isLoading && (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Entonnoir e-mail</CardTitle>
              </CardHeader>
              <CardContent>
                <DeliveryFunnelChart
                  totals={query.data.data.totals}
                  kind="email"
                  title="Entonnoir e-mail"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Entonnoir push / in-app</CardTitle>
              </CardHeader>
              <CardContent>
                <DeliveryFunnelChart
                  totals={query.data.data.totals}
                  kind="push"
                  title="Entonnoir push"
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Par canal</CardTitle>
              </CardHeader>
              <CardContent>
                <PerChannelBarChart
                  data={query.data.data.perChannel}
                  title="Succès par canal"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Suppressions</CardTitle>
              </CardHeader>
              <CardContent>
                <SuppressionDonut
                  totals={query.data.data.totals.suppressed}
                  title="Motifs de suppression"
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Évolution temporelle (7 j)</CardTitle>
            </CardHeader>
            <CardContent>
              <DeliveryTimeseriesChart
                data={query.data.data.timeseries}
                granularity="day"
                title="Volumes par jour"
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
