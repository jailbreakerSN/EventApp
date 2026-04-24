"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "@/lib/api-client";
import type { AdminJobRunsQuery } from "@teranga/shared-types";

/**
 * T2.2 — Admin job runner hooks.
 *
 * Four entry points:
 *   - `useAdminJobs()`          — registered-handler catalog
 *   - `useAdminJobRuns(query)`  — paginated run history
 *   - `useAdminJobRun(runId)`   — single run detail (modal)
 *   - `useRunAdminJob()`        — mutation to trigger a run
 *
 * The trigger mutation invalidates the runs list on success so the
 * history refreshes without a manual reload. We do NOT invalidate on
 * error — a 409 (already running) or 400 (bad input) leaves no new
 * row to fetch and cache invalidation would just waste a round trip.
 */

export function useAdminJobs() {
  return useQuery({
    queryKey: ["admin", "jobs", "registry"],
    queryFn: () => adminApi.listJobs(),
    // Registry is static server-side; refresh lazily.
    staleTime: 5 * 60_000,
  });
}

export function useAdminJobRuns(query: Partial<AdminJobRunsQuery> = {}) {
  return useQuery({
    queryKey: ["admin", "jobs", "runs", query],
    queryFn: () => adminApi.listJobRuns(query),
    // Short stale time so operators see fresh status without a manual
    // refetch. A run that flips from running → succeeded should land
    // within ~15 s of completion even if nothing else is clicked.
    refetchInterval: 15_000,
  });
}

export function useAdminJobRun(runId: string | null) {
  return useQuery({
    queryKey: ["admin", "jobs", "run", runId],
    queryFn: () => adminApi.getJobRun(runId!),
    enabled: !!runId,
    // Running runs update in place; poll the detail endpoint every 2 s
    // while the modal is open, stop once the run lands on a terminal
    // status.
    refetchInterval: (q) => {
      const status = (q.state.data?.data as { status?: string } | undefined)?.status;
      if (status === "queued" || status === "running") return 2_000;
      return false;
    },
  });
}

export function useRunAdminJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { jobKey: string; input?: Record<string, unknown> }) =>
      adminApi.runJob(params.jobKey, params.input),
    onSuccess: () => {
      // Invalidate the runs list so the new row appears. The registry
      // catalog itself doesn't change so we leave it alone.
      void qc.invalidateQueries({ queryKey: ["admin", "jobs", "runs"] });
    },
  });
}
