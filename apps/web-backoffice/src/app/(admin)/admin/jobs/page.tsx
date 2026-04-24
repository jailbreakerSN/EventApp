"use client";

/**
 * T2.2 — Admin job runner UI.
 *
 * Two stacked surfaces:
 *   1. **Registered jobs** — card grid, one card per handler. Shows
 *      title, description, optional danger note, "Run" button. If
 *      the handler declares input (`hasInput: true`), the button
 *      opens an inline JSON textarea for the body. On submit, hits
 *      `POST /v1/admin/jobs/:jobKey/run` and opens the detail modal
 *      for the newly-created run.
 *   2. **Recent runs** — paginated history. Status badge, duration,
 *      triggered-by, click-through to the detail modal. Polls every
 *      15 s so operators see in-flight status transitions.
 *
 * Every action is guarded by the API's `requirePermission
 * ("platform:manage")`. Client-side error surfacing goes through the
 * standard `useErrorHandler` → `InlineErrorBanner` path.
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
  Button,
  Card,
  CardContent,
  InlineErrorBanner,
  SectionHeader,
  Skeleton,
} from "@teranga/shared-ui";
import { AlertTriangle, PlayCircle, Clock, User2 } from "lucide-react";
import type { AdminJobDescriptor, AdminJobRun, AdminJobStatus } from "@teranga/shared-types";
import { useAdminJobs, useAdminJobRuns, useRunAdminJob } from "@/hooks/use-admin-jobs";
import { useErrorHandler } from "@/hooks/use-error-handler";
import { JobRunDetailModal } from "@/components/admin/job-run-detail-modal";

function statusVariant(s: AdminJobStatus): "success" | "destructive" | "info" | "neutral" {
  if (s === "succeeded") return "success";
  if (s === "failed") return "destructive";
  if (s === "running" || s === "queued") return "info";
  return "neutral";
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export default function AdminJobsPage() {
  const { data: jobsData, isLoading: jobsLoading } = useAdminJobs();
  const { data: runsData, isLoading: runsLoading } = useAdminJobRuns({ limit: 50 });
  const runJob = useRunAdminJob();
  const { resolve } = useErrorHandler();

  // Per-job local state for the inline input editor. `null` = collapsed,
  // string = current textarea contents for that jobKey. Scoped to this
  // component so nothing leaks between renders.
  const [openInputs, setOpenInputs] = useState<Record<string, string>>({});
  const [runError, setRunError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const jobs: AdminJobDescriptor[] = jobsData?.data ?? [];
  const runs: AdminJobRun[] = runsData?.data ?? [];

  const toggleInput = (jobKey: string) => {
    setOpenInputs((prev) => {
      const next = { ...prev };
      if (jobKey in next) {
        delete next[jobKey];
      } else {
        const job = jobs.find((j) => j.jobKey === jobKey);
        next[jobKey] = job?.exampleInput ? JSON.stringify(job.exampleInput, null, 2) : "{}";
      }
      return next;
    });
  };

  const handleRun = async (job: AdminJobDescriptor) => {
    setRunError(null);
    let input: Record<string, unknown> | undefined;
    if (job.hasInput) {
      const raw = openInputs[job.jobKey];
      if (raw) {
        try {
          input = JSON.parse(raw);
        } catch {
          setRunError(`Input JSON invalide pour ${job.jobKey}`);
          return;
        }
      } else {
        input = {};
      }
    }
    try {
      const res = await runJob.mutateAsync({ jobKey: job.jobKey, input });
      setActiveRunId(res.data.id);
    } catch (err) {
      setRunError(resolve(err).description);
    }
  };

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Administration</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Jobs</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <SectionHeader
        kicker="— Platform"
        title="Job runner"
        subtitle="Déclencheurs côté serveur pour les tâches de maintenance (backfills, sweeps, smoke-tests)."
      />

      {runError && (
        <InlineErrorBanner
          severity="destructive"
          kicker="— Erreur"
          title="Le job n'a pas pu être lancé"
          description={runError}
        />
      )}

      {/* Registered-jobs grid ------------------------------------------------ */}
      <section className="space-y-3">
        <h2 className="font-mono-kicker text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          — Jobs enregistrés
        </h2>

        {jobsLoading && (
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton variant="text" className="h-28 w-full" />
            <Skeleton variant="text" className="h-28 w-full" />
          </div>
        )}

        {!jobsLoading && jobs.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Aucun job enregistré pour le moment.
            </CardContent>
          </Card>
        )}

        {!jobsLoading && jobs.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {jobs.map((job) => {
              const inputOpen = job.jobKey in openInputs;
              return (
                <Card key={job.jobKey}>
                  <CardContent className="space-y-3 p-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <code className="font-mono text-xs font-semibold text-foreground">
                          {job.jobKey}
                        </code>
                        {job.dangerNoteFr && (
                          <Badge variant="destructive" className="gap-1 text-[10px]">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                            Attention
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm font-semibold text-foreground">{job.titleFr}</div>
                      <p className="text-xs text-muted-foreground">{job.descriptionFr}</p>
                      {job.dangerNoteFr && (
                        <p className="text-xs text-destructive">{job.dangerNoteFr}</p>
                      )}
                    </div>

                    {job.hasInput && inputOpen && (
                      <textarea
                        aria-label={`Input JSON pour ${job.jobKey}`}
                        value={openInputs[job.jobKey]}
                        onChange={(e) =>
                          setOpenInputs((prev) => ({ ...prev, [job.jobKey]: e.target.value }))
                        }
                        rows={4}
                        className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
                      />
                    )}

                    <div className="flex items-center gap-2">
                      {job.hasInput && (
                        <Button variant="outline" size="sm" onClick={() => toggleInput(job.jobKey)}>
                          {inputOpen ? "Fermer l'input" : "Éditer l'input"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => void handleRun(job)}
                        disabled={runJob.isPending}
                        className="gap-1"
                      >
                        <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        Lancer
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent runs --------------------------------------------------------- */}
      <section className="space-y-3">
        <h2 className="font-mono-kicker text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          — Derniers runs
        </h2>

        {runsLoading && <Skeleton variant="text" className="h-32 w-full" />}
        {!runsLoading && runs.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Aucun run enregistré. Cliquez sur « Lancer » ci-dessus pour créer le premier.
            </CardContent>
          </Card>
        )}
        {!runsLoading && runs.length > 0 && (
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setActiveRunId(run.id)}
                  className="flex w-full items-center justify-between gap-4 p-3 text-left text-sm transition-colors hover:bg-accent/50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <PlayCircle
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <code className="truncate font-mono text-xs font-semibold">{run.jobKey}</code>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        <span>{new Date(run.triggeredAt).toLocaleString("fr-FR")}</span>
                        <span>·</span>
                        <span>{formatDuration(run.durationMs)}</span>
                        <span>·</span>
                        <User2 className="h-3 w-3" aria-hidden="true" />
                        <span>{run.triggeredByDisplayName ?? run.triggeredBy}</span>
                      </div>
                    </div>
                  </div>
                  <Badge variant={statusVariant(run.status)} className="shrink-0 text-[10px]">
                    {run.status}
                  </Badge>
                </button>
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      <JobRunDetailModal runId={activeRunId} onClose={() => setActiveRunId(null)} />
    </div>
  );
}
