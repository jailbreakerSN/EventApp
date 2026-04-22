"use client";

/**
 * Real-time arrival listener for the `notifications` Firestore collection.
 *
 * Complements the polling `useNotifications` / `useUnreadCount` React-Query
 * hooks: React Query keeps the panel list + badge count consistent across
 * refetches and tab focus, and this hook catches the moment a NEW
 * notification appears so we can
 *   1. invalidate the query cache (panel + badge update instantly instead
 *      of waiting up to 30s for the next poll), and
 *   2. fire a toast so the user sees the new arrival without opening the
 *      panel.
 *
 * Why a separate listener vs. pushing the snapshot into React Query
 * directly: the backoffice's list endpoint paginates + filters server-side,
 * and Firestore's `onSnapshot` doesn't know about the API's pagination
 * shape. Keeping them separate means:
 *   - the source of truth for display stays REST (auth-aware, filtered,
 *     paginated), and
 *   - real-time is purely a "nudge" channel — no duplicate rendering, no
 *     race between snapshot and API.
 *
 * First-run behaviour: the initial snapshot ALWAYS fires with the rows
 * Firestore already has. We detect it via `metadata.fromCache` + a
 * `hasReceivedInitial` ref so we don't spam toasts for rows the user has
 * already seen across tabs.
 */

import * as React from "react";
import {
  collection,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { firestore } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";

interface LiveNotification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  isRead: boolean;
}

export interface UseNotificationLiveStreamOptions {
  /**
   * Called with the freshly-arrived notification so callers can route
   * a custom toast payload (e.g. with an action button). When omitted
   * the hook fires a minimal toast with the title.
   */
  onArrived?: (notification: LiveNotification) => void;
  /**
   * Maximum number of most-recent rows to subscribe to. Too high = more
   * Firestore reads + memory; too low = a quick succession of new
   * notifications can evict older ones before the panel re-queries.
   * Default matches the bell panel's limit.
   */
  limit?: number;
}

export function useNotificationLiveStream(options: UseNotificationLiveStreamOptions = {}): void {
  const { onArrived, limit = 10 } = options;
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const queryClient = useQueryClient();
  // One stable ref of seen ids — survives re-renders without re-subscribing.
  const seenIdsRef = React.useRef<Set<string>>(new Set());
  const hasReceivedInitialRef = React.useRef(false);

  React.useEffect(() => {
    if (!uid) {
      seenIdsRef.current = new Set();
      hasReceivedInitialRef.current = false;
      return;
    }

    const q = query(
      collection(firestore, "notifications"),
      where("userId", "==", uid),
      orderBy("createdAt", "desc"),
      fsLimit(limit),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        // Seed the seen set from the first snapshot so we don't treat
        // every historical row as "new" the first time the bell mounts.
        if (!hasReceivedInitialRef.current) {
          snapshot.docs.forEach((doc) => seenIdsRef.current.add(doc.id));
          hasReceivedInitialRef.current = true;
          return;
        }

        // Only docChanges with type === "added" are new arrivals; modified
        // / removed are user-initiated (mark-as-read) and don't need a
        // toast. Rows already in the seen set are ignored — Firestore can
        // re-emit an "added" change after a reconnect.
        const newlyArrived: LiveNotification[] = [];
        for (const change of snapshot.docChanges()) {
          if (change.type !== "added") continue;
          const id = change.doc.id;
          if (seenIdsRef.current.has(id)) continue;
          seenIdsRef.current.add(id);
          const data = change.doc.data() as {
            title?: string;
            body?: string;
            createdAt?: string;
            isRead?: boolean;
          };
          newlyArrived.push({
            id,
            title: data.title ?? "Nouvelle notification",
            body: data.body ?? "",
            createdAt: data.createdAt ?? new Date().toISOString(),
            isRead: Boolean(data.isRead),
          });
        }

        if (newlyArrived.length === 0) return;

        // Invalidate so the panel + badge show the new row on next open
        // / next render without waiting for the 30s poll.
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });

        for (const n of newlyArrived) {
          if (onArrived) {
            onArrived(n);
          } else {
            // Minimal default toast — caller opts in to a richer payload
            // by supplying onArrived.
            toast(n.title, {
              description: n.body || undefined,
              duration: 6000,
            });
          }
        }
      },
      (err) => {
        // Firestore permission errors would mean the rules changed or the
        // user lost access mid-session. Log once, don't toast — a broken
        // listener shouldn't visibly spam the user.
        console.error("[useNotificationLiveStream] listener error", err);
      },
    );

    return () => {
      unsubscribe();
    };
  }, [uid, limit, queryClient, onArrived]);
}
