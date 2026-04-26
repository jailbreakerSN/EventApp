"use client";

/**
 * Organizer overhaul — Phase O9.
 *
 * React Query hooks + helpers for the post-event surface:
 *   - `usePostEventReport`     — JSON snapshot (attendance + comms + finance).
 *   - `useReconciliation`      — per-(method, status) financial matrix.
 *   - `useGeneratePostEventPdf` — server-rendered PDF, opens in a new tab.
 *   - `useDownloadCohortCsv`   — fetch + Blob download with the bearer token.
 *   - `useRequestPayout`       — POST + invalidations on the payouts list.
 *
 * All queries gate on `enabled: Boolean(eventId)` so the page can fall
 * through to a skeleton while the URL params resolve.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { firebaseAuth } from "@/lib/firebase";
import type {
  CohortSegment,
  Payout,
  PostEventReport,
  ReconciliationSummary,
} from "@teranga/shared-types";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const REPORT_STALE_MS = 30_000;

// ─── JSON snapshot ────────────────────────────────────────────────────────

export function usePostEventReport(eventId: string | null | undefined) {
  return useQuery({
    queryKey: ["post-event-report", eventId],
    queryFn: async () => {
      const res = await api.get<ApiEnvelope<PostEventReport>>(
        `/v1/events/${eventId}/post-event/report`,
      );
      return res.data;
    },
    enabled: Boolean(eventId),
    staleTime: REPORT_STALE_MS,
  });
}

// ─── Reconciliation ───────────────────────────────────────────────────────

export function useReconciliation(eventId: string | null | undefined) {
  return useQuery({
    queryKey: ["reconciliation", eventId],
    queryFn: async () => {
      const res = await api.get<ApiEnvelope<ReconciliationSummary>>(
        `/v1/events/${eventId}/post-event/reconciliation`,
      );
      return res.data;
    },
    enabled: Boolean(eventId),
    staleTime: REPORT_STALE_MS,
  });
}

// ─── PDF (signed URL → open in new tab) ───────────────────────────────────

export function useGeneratePostEventPdf(eventId: string) {
  return useMutation({
    mutationFn: async (): Promise<{ pdfURL: string; report: PostEventReport }> => {
      const res = await api.get<ApiEnvelope<{ pdfURL: string; report: PostEventReport }>>(
        `/v1/events/${eventId}/post-event/report.pdf`,
      );
      return res.data;
    },
  });
}

// ─── Cohort CSV (fetch + Blob → triggered <a> download) ───────────────────

export function useDownloadCohortCsv(eventId: string) {
  return useMutation({
    mutationFn: async (segment: CohortSegment): Promise<void> => {
      const user = firebaseAuth.currentUser;
      if (!user) throw new Error("Vous devez être connecté pour exporter.");
      const token = await user.getIdToken();
      const url = `${API_URL}/v1/events/${eventId}/post-event/cohort.csv?segment=${encodeURIComponent(segment)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // The API returns the standard error envelope on JSON 4xx/5xx.
        // Try to surface the server message rather than a generic error.
        let message = `Échec du téléchargement (${res.status})`;
        try {
          const body = (await res.json()) as { error?: { message?: string } };
          if (body.error?.message) message = body.error.message;
        } catch {
          // Body wasn't JSON — leave the default message.
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      triggerBlobDownload(blob, `cohort-${segment}-${eventId}.csv`);
    },
  });
}

// ─── Payout request ───────────────────────────────────────────────────────

export function useRequestPayout(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<Payout> => {
      const res = await api.post<ApiEnvelope<Payout>>(
        `/v1/events/${eventId}/post-event/payout-request`,
        {},
      );
      return res.data;
    },
    onSuccess: () => {
      // The payouts list lives at `/v1/payouts/organization/:orgId` and
      // the reconciliation rows include the resulting balance change.
      qc.invalidateQueries({ queryKey: ["payouts"] });
      qc.invalidateQueries({ queryKey: ["reconciliation", eventId] });
      qc.invalidateQueries({ queryKey: ["post-event-report", eventId] });
    },
  });
}

// ─── Internal helper ─────────────────────────────────────────────────────

function triggerBlobDownload(blob: Blob, filename: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer the revoke a tick — Firefox sometimes drops the click before
  // the URL is wired in.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
