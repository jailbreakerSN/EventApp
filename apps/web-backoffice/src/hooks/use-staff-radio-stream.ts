"use client";

/**
 * Organizer overhaul — Phase O8.
 *
 * Realtime listener for the per-event staff radio. Mirrors the pattern
 * established by `useNotificationLiveStream` (Wave 4): a Firestore
 * `onSnapshot` query feeds a local React state buffer, the React Query
 * cache stays as the cold-start fallback (`useStaffMessages`).
 *
 * Why a separate listener vs. polling: messages need sub-second
 * delivery during a hot floor-ops moment. Polling at 5–10 s would feel
 * laggy; Firestore realtime is the cheaper alternative.
 *
 * The listener subscribes to the most recent N messages (default 100).
 * On reconnect, Firestore re-emits the seed snapshot — we treat the
 * first snapshot as a baseline and only stream the deltas afterward.
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
import { firestore } from "@/lib/firebase";
import type { StaffMessage } from "@teranga/shared-types";

const DEFAULT_LIMIT = 100;
const COLLECTION = "staffMessages";

export interface StaffRadioStreamState {
  messages: StaffMessage[];
  isReady: boolean;
  error: string | null;
}

export function useStaffRadioStream(
  eventId: string | null | undefined,
  options: { limit?: number } = {},
): StaffRadioStreamState {
  const { limit = DEFAULT_LIMIT } = options;
  const [messages, setMessages] = React.useState<StaffMessage[]>([]);
  const [isReady, setIsReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!eventId) {
      setMessages([]);
      setIsReady(false);
      setError(null);
      return;
    }

    setIsReady(false);
    setError(null);

    const q = query(
      collection(firestore, COLLECTION),
      where("eventId", "==", eventId),
      orderBy("createdAt", "desc"),
      fsLimit(limit),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        // We requested DESC for the limit, then flip to ASC for the UI
        // (oldest at top, newest at bottom — matches a chat panel).
        const docs = snapshot.docs.map((d) => d.data() as StaffMessage);
        docs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        setMessages(docs);
        setIsReady(true);
      },
      (err) => {
        console.error("[useStaffRadioStream] listener error", err);
        setError(err.message ?? "Erreur de connexion à la radio staff");
      },
    );

    return () => {
      unsubscribe();
    };
  }, [eventId, limit]);

  return { messages, isReady, error };
}
