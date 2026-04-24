"use client";

/**
 * T2.1 — Webhook event detail modal.
 *
 * Opened from a row click in `/admin/webhooks`. Shows:
 *   - provider + providerTransactionId + status badges
 *   - timing (firstReceivedAt / lastAttemptedAt) + attempts counter
 *   - associated paymentId + organizationId (best-effort stamps)
 *   - raw body (pretty-printed when JSON)
 *   - rawHeaders
 *   - lastError (code + message) on failure
 *   - "Rejouer" button (disabled while inflight)
 */

import { useEffect, useState } from "react";
import { Badge, Button, InlineErrorBanner } from "@teranga/shared-ui";
import { X, RotateCw } from "lucide-react";
import type { WebhookEventLog, WebhookProcessingStatus } from "@teranga/shared-types";
import { useAdminWebhookEvent, useReplayWebhookEvent } from "@/hooks/use-admin-webhooks";
import { useErrorHandler } from "@/hooks/use-error-handler";

function statusVariant(s: WebhookProcessingStatus): "success" | "destructive" | "info" | "neutral" {
  if (s === "processed") return "success";
  if (s === "failed") return "destructive";
  if (s === "received") return "info";
  return "neutral";
}

function formatTs(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR");
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

interface Props {
  webhookId: string | null;
  onClose: () => void;
}

export function WebhookEventDetailModal({ webhookId, onClose }: Props) {
  const { data, isLoading } = useAdminWebhookEvent(webhookId);
  const replay = useReplayWebhookEvent();
  const { resolve } = useErrorHandler();
  const [replayError, setReplayError] = useState<string | null>(null);

  useEffect(() => {
    setReplayError(null);
  }, [webhookId]);

  if (!webhookId) return null;
  const event: WebhookEventLog | null = data?.data ?? null;

  const handleReplay = async () => {
    if (!webhookId) return;
    setReplayError(null);
    try {
      await replay.mutateAsync(webhookId);
    } catch (err) {
      setReplayError(resolve(err).description);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Détail du webhook"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col gap-4 overflow-hidden rounded-xl border border-border bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Webhook</div>
            <code className="block truncate font-mono text-sm font-semibold">{webhookId}</code>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-md p-1 hover:bg-accent"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {isLoading && !event && <div className="text-sm text-muted-foreground">Chargement…</div>}

        {event && (
          <div className="flex-1 space-y-4 overflow-y-auto text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="neutral">{event.provider}</Badge>
              <Badge variant={event.providerStatus === "succeeded" ? "success" : "destructive"}>
                provider: {event.providerStatus}
              </Badge>
              <Badge variant={statusVariant(event.processingStatus)}>
                handler: {event.processingStatus}
              </Badge>
              <span className="font-mono text-[11px] text-muted-foreground">
                #{event.attempts} {event.attempts > 1 ? "tentatives" : "tentative"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground">Reçu</div>
                <div>{formatTs(event.firstReceivedAt)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Dernière tentative</div>
                <div>{formatTs(event.lastAttemptedAt)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Provider Transaction</div>
                <code className="font-mono text-[11px]">{event.providerTransactionId}</code>
              </div>
              <div>
                <div className="text-muted-foreground">Type</div>
                <div>{event.eventType ?? "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Payment</div>
                <code className="font-mono text-[11px]">{event.paymentId ?? "—"}</code>
              </div>
              <div>
                <div className="text-muted-foreground">Organisation</div>
                <code className="font-mono text-[11px]">{event.organizationId ?? "—"}</code>
              </div>
            </div>

            {event.lastError && (
              <div>
                <div className="mb-1 text-xs font-semibold text-destructive">Erreur</div>
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
                  <code className="font-mono font-semibold">{event.lastError.code}</code>
                  <div className="mt-1 text-muted-foreground">{event.lastError.message}</div>
                </div>
              </div>
            )}

            {replayError && (
              <InlineErrorBanner
                severity="destructive"
                kicker="— Erreur"
                title="Le replay a échoué"
                description={replayError}
              />
            )}

            {event.metadata && Object.keys(event.metadata).length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold text-muted-foreground">Metadata</div>
                <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-[11px]">
                  {JSON.stringify(event.metadata, null, 2)}
                </pre>
              </div>
            )}

            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">Raw body</div>
              <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-[11px] whitespace-pre-wrap break-words">
                {prettyJson(event.rawBody)}
              </pre>
            </div>

            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">
                Raw headers (signatures only)
              </div>
              <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-[11px]">
                {JSON.stringify(event.rawHeaders, null, 2)}
              </pre>
            </div>
          </div>
        )}

        <div className="flex justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleReplay()}
            disabled={replay.isPending || !event}
            className="gap-1"
          >
            <RotateCw
              className={replay.isPending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"}
              aria-hidden="true"
            />
            {replay.isPending ? "Replay en cours…" : "Rejouer"}
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </div>
  );
}
