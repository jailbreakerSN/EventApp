"use client";

/**
 * Phase 2.4 — Edit-history panel for a single notification key. Expands
 * inline below the main table when an admin clicks "Historique" on a row.
 * Shows the last 20 writes with actor + diff + scope (platform vs. per-org).
 *
 * The backing endpoint (GET /v1/admin/notifications/:key/history) is
 * super-admin only and returns an append-only sequence of writes —
 * same source of truth the audit log builds on.
 */

import { useEffect, useRef, useState } from "react";
import { Badge, Button, InlineErrorBanner, Skeleton } from "@teranga/shared-ui";
import { X } from "lucide-react";
import { adminNotificationsApi, type AdminNotificationHistoryEntry } from "@/lib/api-client";
import { useErrorHandler } from "@/hooks/use-error-handler";

interface HistoryPanelProps {
  notificationKey: string;
  organizationId?: string;
  onClose: () => void;
}

export function HistoryPanel({ notificationKey, organizationId, onClose }: HistoryPanelProps) {
  const { resolve } = useErrorHandler();
  const [entries, setEntries] = useState<AdminNotificationHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The panel renders below the notification table, which on staging carries
  // 34+ rows. Without a scroll-into-view the admin clicks "Historique" and
  // sees literally nothing change because the panel lives below the fold.
  // Staging bug report: "Je clique sur Historique, rien ne se passe dans
  // l'UI". Auto-focusing the mounted panel gives immediate visual feedback
  // AND moves keyboard focus for accessibility.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // Defer to the next frame so the panel has painted before scrolling.
    const id = requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      panelRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [notificationKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminNotificationsApi
      .history(notificationKey, { limit: 20, ...(organizationId ? { organizationId } : {}) })
      .then((res) => {
        if (cancelled) return;
        setEntries(res.data.entries);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(resolve(err).description);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [notificationKey, organizationId, resolve]);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="region"
      aria-labelledby={`history-title-${notificationKey}`}
      className="rounded-md border-2 border-teranga-gold/60 bg-muted/10 p-4 outline-none focus-visible:ring-2 focus-visible:ring-teranga-gold"
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div
            id={`history-title-${notificationKey}`}
            className="text-sm font-semibold text-foreground"
          >
            Historique — <code className="font-mono text-[11px]">{notificationKey}</code>
          </div>
          <div className="text-xs text-muted-foreground">
            {organizationId ? `Organisation ${organizationId}` : "Paramètre plateforme"}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fermer l'historique">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      {error && (
        <InlineErrorBanner
          severity="destructive"
          kicker="— Erreur"
          title="Impossible de charger l'historique"
          description={error}
        />
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} variant="text" className="h-5 w-full" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune modification enregistrée.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-md border border-border bg-background p-3 text-xs"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {formatDateTime(entry.changedAt)}
                </span>
                <Badge variant="neutral" className="text-[10px]">
                  {entry.actorRole}
                </Badge>
                {entry.organizationId ? (
                  <Badge variant="info" className="text-[10px]">
                    org:{entry.organizationId}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">
                    plateforme
                  </Badge>
                )}
                <span className="text-muted-foreground">
                  par <code className="font-mono">{entry.actorId}</code>
                </span>
              </div>
              {entry.diff.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {entry.diff.map((field) => (
                    <Badge key={field} variant="outline" className="text-[10px]">
                      {field}
                    </Badge>
                  ))}
                </div>
              )}
              {entry.reason && <div className="mt-1 text-muted-foreground">« {entry.reason} »</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-SN", { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}
