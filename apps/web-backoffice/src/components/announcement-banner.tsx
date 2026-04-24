"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Info, AlertTriangle, AlertOctagon } from "lucide-react";
import { api } from "@/lib/api-client";

/**
 * T2.4 — Platform announcement banner.
 *
 * Reads from `GET /v1/announcements` (authenticated endpoint that
 * returns all `active`, unexpired announcements for the caller's
 * audience). Rendering rules:
 *
 *   - We show AT MOST ONE banner at a time (newest first) to avoid
 *     wrecking vertical rhythm on mobile.
 *   - Dismissal is persisted per-announcement in localStorage
 *     (`teranga:announcement-dismissed:<id>`). A refresh won't
 *     resurrect a dismissed banner.
 *   - Severity drives colour + icon: info (blue), warning (amber),
 *     critical (red, non-dismissible).
 *   - Critical banners cannot be dismissed — they stay visible until
 *     the super-admin sets `expiresAt` or toggles `active: false`.
 *
 * Why localStorage for dismissal (vs a per-user Firestore write):
 * browsing-session-local is the right granularity for banners. A
 * dismissal shouldn't cross devices (the message is already visible
 * everywhere else on the platform), and writing a per-user
 * acknowledgment row per banner would be a 1:N explosion for a
 * low-value signal. If compliance ever needs "user X saw banner Y",
 * we can add an acknowledge endpoint later.
 */

interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  audience: "all" | "organizers" | "participants";
  publishedAt: string;
  expiresAt?: string;
  active: boolean;
}

interface AnnouncementsResponse {
  success: boolean;
  data: Announcement[];
}

const DISMISS_KEY_PREFIX = "teranga:announcement-dismissed:";

function isDismissed(id: string): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY_PREFIX + id) === "1";
  } catch {
    return false; // SSR / private mode
  }
}

function setDismissed(id: string): void {
  try {
    localStorage.setItem(DISMISS_KEY_PREFIX + id, "1");
  } catch {
    // Silently no-op — user will see the banner again next time.
  }
}

export function AnnouncementBanner() {
  const { data } = useQuery<AnnouncementsResponse>({
    queryKey: ["announcements", "active"],
    queryFn: () => api.get<AnnouncementsResponse>("/v1/announcements"),
    // Poll every 5 minutes — we don't need instant propagation but
    // a new critical banner SHOULD land without a page refresh.
    refetchInterval: 5 * 60 * 1000,
    // Swallow errors silently — banner is non-critical; a 404/500
    // should never break the dashboard.
    retry: 1,
  });

  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Hydrate dismissed set from localStorage once mounted so SSR
  // mismatches don't flash a banner then hide it.
  useEffect(() => {
    const announcements = data?.data ?? [];
    const dismissed = new Set<string>();
    for (const a of announcements) {
      if (isDismissed(a.id)) dismissed.add(a.id);
    }
    setDismissedIds(dismissed);
  }, [data]);

  const announcements = data?.data ?? [];
  // Show the newest non-dismissed one; criticals always win regardless
  // of publishedAt order.
  const visible =
    announcements
      .filter((a) => !dismissedIds.has(a.id))
      .sort((a, b) => {
        if (a.severity === "critical" && b.severity !== "critical") return -1;
        if (b.severity === "critical" && a.severity !== "critical") return 1;
        return b.publishedAt.localeCompare(a.publishedAt);
      })[0] ?? null;

  if (!visible) return null;

  const styles = {
    info: {
      container:
        "bg-blue-50 border-b border-blue-200 text-blue-900 dark:bg-blue-950/50 dark:border-blue-800 dark:text-blue-100",
      icon: Info,
    },
    warning: {
      container:
        "bg-amber-50 border-b border-amber-200 text-amber-900 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-100",
      icon: AlertTriangle,
    },
    critical: {
      container:
        "bg-red-50 border-b border-red-200 text-red-900 dark:bg-red-950/50 dark:border-red-800 dark:text-red-100",
      icon: AlertOctagon,
    },
  } as const;

  const { container, icon: Icon } = styles[visible.severity];

  return (
    <div
      role={visible.severity === "critical" ? "alert" : "status"}
      className={`flex items-start gap-3 px-4 py-2.5 text-sm ${container}`}
    >
      <Icon className="h-5 w-5 shrink-0 mt-0.5" aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="font-semibold">{visible.title}</p>
        <p className="text-xs opacity-90 mt-0.5 whitespace-pre-wrap break-words">{visible.body}</p>
      </div>
      {visible.severity !== "critical" && (
        <button
          type="button"
          onClick={() => {
            setDismissed(visible.id);
            setDismissedIds((prev) => new Set(prev).add(visible.id));
          }}
          className="p-0.5 opacity-70 hover:opacity-100"
          aria-label={`Fermer l'annonce « ${visible.title} »`}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
