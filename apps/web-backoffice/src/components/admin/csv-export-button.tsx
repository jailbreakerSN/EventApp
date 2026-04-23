"use client";

/**
 * Phase 5 — Authenticated CSV export button.
 *
 * We can't use a plain <a href=".../export/users.csv"> because admin
 * routes require the `Authorization: Bearer <idToken>` header — which
 * the browser won't attach to a normal navigation. This button:
 *
 *   1. Gets a fresh ID token from Firebase Auth.
 *   2. fetch()es the export endpoint with the token.
 *   3. Streams the response into a blob.
 *   4. Triggers a synthetic <a download> click on the blob URL.
 *
 * UX:
 *   - Disabled + spinner while the download is running.
 *   - Toast success/failure via sonner (already used elsewhere).
 *   - Filename carries the resource + ISO date so saving to disk
 *     doesn't overwrite a previous export.
 *
 * The endpoint accepts the SAME filters the current list page uses,
 * so the UI pattern is: "export respects your current filtered view".
 * Callers pass the filter querystring directly.
 */

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { firebaseAuth } from "@/lib/firebase";
import { cn } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

interface CsvExportButtonProps {
  /** Resource segment of the URL: users, organizations, events, audit-logs. */
  resource: "users" | "organizations" | "events" | "audit-logs";
  /** Current filter querystring (without leading ?). */
  filters?: string;
  /** Human label; default based on resource. */
  label?: string;
  className?: string;
}

const DEFAULT_LABEL: Record<CsvExportButtonProps["resource"], string> = {
  users: "Exporter utilisateurs",
  organizations: "Exporter organisations",
  events: "Exporter événements",
  "audit-logs": "Exporter audit",
};

export function CsvExportButton({
  resource,
  filters = "",
  label,
  className,
}: CsvExportButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const user = firebaseAuth.currentUser;
      if (!user) {
        toast.error("Session expirée — reconnectez-vous puis réessayez.");
        return;
      }
      const token = await user.getIdToken();
      const qs = filters ? `?${filters.replace(/^\?/, "")}` : "";
      const url = `${API_BASE}/v1/admin/export/${resource}.csv${qs}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`Export HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      const date = new Date().toISOString().slice(0, 10);
      anchor.download = `teranga-${resource}-${date}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      // Revoke lazily on next tick so some browsers have time to kick
      // the download off before GC reclaims the blob.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);

      toast.success("Export téléchargé.");
    } catch (err) {
      toast.error(`Export échoué : ${err instanceof Error ? err.message : "erreur inconnue"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={loading}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50",
        className,
      )}
      aria-label={label ?? DEFAULT_LABEL[resource]}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {label ?? DEFAULT_LABEL[resource]}
    </button>
  );
}
