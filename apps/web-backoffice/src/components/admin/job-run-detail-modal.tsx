"use client";

/**
 * T2.2 — Admin job run detail modal.
 *
 * Surfaced when the operator clicks on a row in the runs table OR
 * immediately after a fresh trigger. Polls the run detail every 2 s
 * while status is `queued` / `running`, then freezes. Shows:
 *   - status badge + timing (triggered / started / completed / duration)
 *   - actor (uid + display name + role)
 *   - input JSON (pretty-printed)
 *   - output blob (handler return + captured log lines, ≤ 10 KB)
 *   - error block (code + message + stack in non-prod) on failure
 *
 * Closing the modal unmounts the polling query.
 */

import { Badge, Button } from "@teranga/shared-ui";
import { X } from "lucide-react";
import { useAdminJobRun } from "@/hooks/use-admin-jobs";
import type { AdminJobStatus } from "@teranga/shared-types";

function statusVariant(s: AdminJobStatus): "success" | "destructive" | "info" | "neutral" {
  if (s === "succeeded") return "success";
  if (s === "failed") return "destructive";
  if (s === "running" || s === "queued") return "info";
  return "neutral";
}

function formatTs(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR");
}

interface JobRunDetailModalProps {
  runId: string | null;
  onClose: () => void;
}

export function JobRunDetailModal({ runId, onClose }: JobRunDetailModalProps) {
  const { data, isLoading } = useAdminJobRun(runId);
  if (!runId) return null;

  const run = data?.data ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Détail du run"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-hidden rounded-xl border border-border bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Run</div>
            <code className="font-mono text-sm font-semibold">{runId}</code>
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

        {isLoading && !run && <div className="text-sm text-muted-foreground">Chargement…</div>}

        {run && (
          <div className="flex-1 space-y-4 overflow-y-auto text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <code className="font-mono text-xs font-semibold">{run.jobKey}</code>
              <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground">Déclenché</div>
                <div>{formatTs(run.triggeredAt)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Démarré</div>
                <div>{formatTs(run.startedAt)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Terminé</div>
                <div>{formatTs(run.completedAt)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Durée</div>
                <div>{run.durationMs == null ? "—" : `${run.durationMs} ms`}</div>
              </div>
              <div className="col-span-2">
                <div className="text-muted-foreground">Actor</div>
                <div>
                  {run.triggeredByDisplayName ?? run.triggeredBy}
                  <code className="ml-2 font-mono text-[10px] text-muted-foreground">
                    ({run.triggeredByRole})
                  </code>
                </div>
              </div>
            </div>

            {run.input && Object.keys(run.input).length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold text-muted-foreground">Input</div>
                <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-[11px]">
                  {JSON.stringify(run.input, null, 2)}
                </pre>
              </div>
            )}

            {run.output && (
              <div>
                <div className="mb-1 text-xs font-semibold text-muted-foreground">Sortie</div>
                <pre className="max-h-80 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-[11px] whitespace-pre-wrap break-words">
                  {run.output}
                </pre>
              </div>
            )}

            {run.error && (
              <div>
                <div className="mb-1 text-xs font-semibold text-destructive">Erreur</div>
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
                  <div>
                    <code className="font-mono font-semibold">{run.error.code}</code>
                  </div>
                  <div className="mt-1 text-muted-foreground">{run.error.message}</div>
                  {run.error.stack && (
                    <pre className="mt-2 max-h-48 overflow-auto font-mono text-[10px] whitespace-pre-wrap text-muted-foreground">
                      {run.error.stack}
                    </pre>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Fermer
          </Button>
        </div>
      </div>
    </div>
  );
}
