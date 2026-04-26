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
} from "@teranga/shared-ui";
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
  const [provider, setProvider] = useState<string>("");
  const [processingStatus, setProcessingStatus] = useState<string>("");
  const [activeWebhookId, setActiveWebhookId] = useState<string | null>(null);

  const { data, isLoading } = useAdminWebhookEvents({
    provider: provider ? (provider as WebhookProvider) : undefined,
    processingStatus: processingStatus ? (processingStatus as WebhookProcessingStatus) : undefined,
    limit: 50,
  });

  const events: WebhookEventLog[] = data?.data ?? [];

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

      {/* Filters --------------------------------------------------------- */}
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
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
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
            value={processingStatus}
            onChange={(e) => setProcessingStatus(e.target.value)}
          >
            <option value="">Tous</option>
            <option value="received">Received</option>
            <option value="processed">Processed</option>
            <option value="failed">Failed</option>
          </Select>
        </div>
      </div>

      {/* Events table --------------------------------------------------- */}
      <Card>
        <CardContent className="p-0">
          {!isLoading && events.length === 0 ? (
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
              emptyMessage="Aucun webhook pour ces filtres"
              responsiveCards
              loading={isLoading}
              data={events as (WebhookEventLog & Record<string, unknown>)[]}
              columns={columns}
              onRowClick={(ev) => setActiveWebhookId(ev.id)}
            />
          )}
        </CardContent>
      </Card>

      <WebhookEventDetailModal
        webhookId={activeWebhookId}
        onClose={() => setActiveWebhookId(null)}
      />
    </div>
  );
}
