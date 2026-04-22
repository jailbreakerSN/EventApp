"use client";

/**
 * Real-time arrival listener for the `notifications` Firestore collection.
 * Mirrors apps/web-backoffice/src/hooks/use-notification-live-stream.ts —
 * kept duplicated per-app rather than hoisted into shared-ui because each
 * app initialises its own Firestore client (see ../lib/firebase.ts in
 * both apps).
 *
 * Responsibilities:
 *   1. Seed a "seen" set from the first snapshot so historical rows don't
 *      trigger toasts the first time the hook mounts (common: user opens
 *      a second tab).
 *   2. On every subsequent `added` docChange, invalidate the React-Query
 *      keys so the bell panel + unread badge update immediately, and fire
 *      a toast with the new row's title.
 *
 * French-first toast copy (participant is a tri-locale app — for the
 * toast channel we pass a callback so the header can localise via
 * next-intl; the default path below uses the raw notification title that
 * the backend already resolves from the catalog's displayName).
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
  onArrived?: (notification: LiveNotification) => void;
  limit?: number;
}

export function useNotificationLiveStream(options: UseNotificationLiveStreamOptions = {}): void {
  const { onArrived, limit = 10 } = options;
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const queryClient = useQueryClient();
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
        if (!hasReceivedInitialRef.current) {
          snapshot.docs.forEach((doc) => seenIdsRef.current.add(doc.id));
          hasReceivedInitialRef.current = true;
          return;
        }

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

        void queryClient.invalidateQueries({ queryKey: ["notifications"] });

        for (const n of newlyArrived) {
          if (onArrived) {
            onArrived(n);
          } else {
            toast(n.title, {
              description: n.body || undefined,
              duration: 6000,
            });
          }
        }
      },
      (err) => {
        console.error("[useNotificationLiveStream] listener error", err);
      },
    );

    return () => {
      unsubscribe();
    };
  }, [uid, limit, queryClient, onArrived]);
}
