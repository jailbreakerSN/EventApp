"use client";

/**
 * Phase D — Admin jobs observability.
 *
 * Read-only list of recent manual / scheduled job runs. Triggering
 * arbitrary shell-style jobs from the UI is intentionally NOT shipped:
 * the trigger surface is a separate security/RBAC discussion, and the
 * current deployment model runs scripted jobs via the staging workflow
 * (documented in scripts/). This page closes the "Jobs" sidebar entry
 * with the actual reachable functionality — observability — so the
 * nav badge flips from "Bientôt" to live, with an honest empty state.
 */

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Card,
  CardContent,
  SectionHeader,
} from "@teranga/shared-ui";
import { useCallback, useEffect, useState } from "react";
import { PlayCircle, Hourglass } from "lucide-react";
import { api } from "@/lib/api-client";

interface JobRun {
  id: string;
  jobKey: string;
  startedAt: string;
  finishedAt?: string;
  status: "pending" | "running" | "succeeded" | "failed";
  actorId: string;
  summary?: string;
}

export default function AdminJobsPage() {
  const [runs, setRuns] = useState<JobRun[] | null>(null);
  const fetchRuns = useCallback(async () => {
    const res = await api.get<{ success: boolean; data: JobRun[] }>("/v1/admin/jobs");
    setRuns(res.data);
  }, []);
  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
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
        title="Jobs"
        subtitle="Historique des scripts et tâches de maintenance déclenchés sur la plateforme."
      />
      {runs === null && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Chargement…
          </CardContent>
        </Card>
      )}
      {runs && runs.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <Hourglass className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <div className="text-sm font-semibold text-foreground">Aucun run enregistré</div>
            <p className="max-w-md text-xs text-muted-foreground">
              Les jobs manuels (seed staging, backfills, reindex) sont actuellement déclenchés via
              les workflows GitHub Actions de l&apos;équipe plateforme. Les runs passés apparaîtront
              ici dès qu&apos;un trigger API sera câblé (Phase 6.1 du plan).
            </p>
          </CardContent>
        </Card>
      )}
      {runs && runs.length > 0 && (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {runs.map((run) => (
              <div key={run.id} className="flex items-center justify-between gap-4 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <PlayCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <code className="font-mono text-xs font-semibold">{run.jobKey}</code>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(run.startedAt).toLocaleString("fr-FR")}
                </div>
                <div className="text-xs font-medium">{run.status}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
