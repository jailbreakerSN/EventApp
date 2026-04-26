"use client";

/**
 * T2.1 — Payment webhook events + replay console.
 *
 * Replaces the Phase D placeholder. Displays the full `webhookEvents`
 * collection with filters (provider, processing status) + polling +
 * click-through to the detail modal with a "Rejouer" action. Mirror
 * of /admin/jobs for provider webhooks.
 *
 * Polls at 15 s via the hook so in-flight / retried webhooks show up
 * without a manual refresh. Every action is gated server-side by
 * `requirePermission("platform:manage")`.
 */

import { useState } from "react";
import { parseAsString } from "nuqs";
import { useTableState } from "@/hooks/use-table-state";
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
  DataTable,
  type DataTableColumn,
  SectionHeader,
  Select,
  Button,
  ResultCount,
  PageSizeSelector,
} from "@teranga/shared-ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Clock, Webhook } from "lucide-react";
import type {
  WebhookEventLog,
  WebhookProcessingStatus,
  WebhookProvider,
} from "@teranga/shared-types";
import { useAdminWebhookEvents } from "@/hooks/use-admin-webhooks";
import { WebhookEventDetailModal } from "@/components/admin/webhook-event-detail-modal";

function processingVariant(
  s: WebhookProcessingStatus,
): "success" | "destructive" | "info" | "neutral" {
  if (s === "processed") return "success";
  if (s === "failed") return "destructive";
  if (s === "received") return "info";
  return "neutral";
}

function providerLabel(p: WebhookProvider): string {
  switch (p) {
    case "wave":
      return "Wave";
    case "orange_money":
      return "Orange Money";
    case "free_money":
      return "Free Money";
    case "card":
      return "Carte bancaire";
    case "mock":
      return "Mock (dev)";
    case "paydunya":
      return "PayDunya";
  }
}

export default function AdminWebhooksPage() {
  const [activeWebhookId, setActiveWebhookId] = useState<string | null>(null);

  // W3 migration — useTableState owns URL state for the filter dropdowns
  // and page / pageSize. The webhook log is a stream archetype (time is
  // the contract); no user-chosen sort UI. Doctrine: chronological, with
  // filter narrowing.
  const t = useTableState<{ provider?: string; processingStatus?: string }>({
    urlNamespace: "webhooks",
    defaults: { sort: null, pageSize: 25 },
    sortableFields: [],
    filterParsers: { provider: parseAsString, processingStatus: parseAsString },
  });

  const { data, isLoading } = useAdminWebhookEvents({
    provider: t.filters.provider ? (t.filters.provider as WebhookProvider) : undefined,
    processingStatus: t.filters.processingStatus
      ? (t.filters.processingStatus as WebhookProcessingStatus)
      : undefined,
    page: t.page,
    limit: t.pageSize,
  });

  const events: WebhookEventLog[] = data?.data ?? [];
  const meta = data?.meta ?? { page: 1, limit: t.pageSize, total: 0, totalPages: 1 };
  const hasActive = t.activeFilterCount > 0;

  const columns: DataTableColumn<WebhookEventLog & Record<string, unknown>>[] = [
    {
      key: "provider",
      header: "Provider",
      primary: true,
      render: (ev) => (
        <div>
          <div className="font-medium text-foreground">{providerLabel(ev.provider)}</div>
          <code className="block max-w-[280px] truncate font-mono text-[11px] text-muted-foreground">
            {ev.providerTransactionId}
          </code>
        </div>
      ),
    },
    {
      key: "providerStatus",
      header: "Provider status",
      hideOnMobile: true,
      render: (ev) => (
        <Badge variant={ev.providerStatus === "succeeded" ? "success" : "destructive"}>
          {ev.providerStatus}
        </Badge>
      ),
    },
    {
      key: "processingStatus",
      header: "Traitement",
      render: (ev) => (
        <div className="flex items-center gap-2">
          <Badge variant={processingVariant(ev.processingStatus)}>{ev.processingStatus}</Badge>
          {ev.attempts > 1 && (
            <span className="font-mono text-[10px] text-muted-foreground">#{ev.attempts}</span>
          )}
        </div>
      ),
    },
    {
      key: "firstReceivedAt",
      header: "Reçu",
      hideOnMobile: true,
      render: (ev) => (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {new Date(ev.firstReceivedAt).toLocaleString("fr-FR")}
        </span>
      ),
    },
  ];

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Administration</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Webhooks</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <SectionHeader
        kicker="— Platform"
        title="Webhooks"
        subtitle="Historique et replay des webhooks reçus des fournisseurs de paiement (Wave, Orange Money, Free Money)."
      />

      {/* Toolbar — filters + result count + page-size --------------------- */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px] flex-1 sm:flex-initial">
            <label
              htmlFor="provider-filter"
              className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
            >
              Provider
            </label>
            <Select
              id="provider-filter"
              value={t.filters.provider ?? ""}
              onChange={(e) => t.setFilter("provider", e.target.value || undefined)}
              aria-label="Filtrer par provider"
            >
              <option value="">Tous</option>
              <option value="wave">Wave</option>
              <option value="orange_money">Orange Money</option>
              <option value="free_money">Free Money</option>
              <option value="mock">Mock (dev)</option>
            </Select>
          </div>
          <div className="min-w-[180px] flex-1 sm:flex-initial">
            <label
              htmlFor="status-filter"
              className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
            >
              Traitement
            </label>
            <Select
              id="status-filter"
              value={t.filters.processingStatus ?? ""}
              onChange={(e) => t.setFilter("processingStatus", e.target.value || undefined)}
              aria-label="Filtrer par statut de traitement"
            >
              <option value="">Tous</option>
              <option value="received">Received</option>
              <option value="processed">Processed</option>
              <option value="failed">Failed</option>
            </Select>
          </div>
          {hasActive ? (
            <button
              type="button"
              onClick={t.reset}
              className="self-end text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              Tout effacer
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <ResultCount total={meta.total} loading={isLoading} />
          <PageSizeSelector value={t.pageSize} onChange={t.setPageSize} />
        </div>
      </div>

      {/* Events table --------------------------------------------------- */}
      <Card>
        <CardContent className="p-0">
          {!isLoading && events.length === 0 && !hasActive ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <Webhook className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <div className="text-sm font-semibold text-foreground">Aucun webhook enregistré</div>
              <p className="max-w-md text-xs text-muted-foreground">
                Les webhooks reçus des providers de paiement apparaîtront ici dès la première
                livraison. Filtrez par provider ou statut de traitement pour cibler un incident.
              </p>
            </div>
          ) : (
            <DataTable<WebhookEventLog & Record<string, unknown>>
              aria-label="Historique des webhooks"
              emptyMessage="Aucun résultat — essayez d'élargir les filtres."
              responsiveCards
              loading={isLoading}
              data={events as (WebhookEventLog & Record<string, unknown>)[]}
              columns={columns}
              onRowClick={(ev) => setActiveWebhookId(ev.id)}
            />
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {!isLoading && meta.totalPages > 1 ? (
        <nav
          aria-label="Pagination des webhooks"
          className="flex items-center justify-between text-sm text-muted-foreground"
        >
          <span aria-current="page">
            Page {meta.page} sur {meta.totalPages} ({meta.total} webhook{meta.total > 1 ? "s" : ""})
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => t.setPage(Math.max(1, t.page - 1))}
              disabled={t.page <= 1}
              aria-label="Page précédente"
            >
              <ChevronLeft className="h-4 w-4" />
              Précédent
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => t.setPage(Math.min(meta.totalPages, t.page + 1))}
              disabled={t.page >= meta.totalPages}
              aria-label="Page suivante"
            >
              Suivant
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </nav>
      ) : null}

      <WebhookEventDetailModal
        webhookId={activeWebhookId}
        onClose={() => setActiveWebhookId(null)}
      />
    </div>
  );
}
