"use client";

/**
 * Organizer overhaul — Phase O8.
 *
 * Per-event staff radio chat panel. Append-only by design — messages
 * cannot be edited or deleted (audit log + cognitive simplicity for
 * floor ops). Realtime via `useStaffRadioStream` (Firestore onSnapshot
 * subscription); the API hook `useStaffMessages` remains the
 * cold-start fallback via React Query so the user sees something
 * instantly on first paint.
 *
 * UX:
 *  - Chat-style scrolling panel; auto-scroll to bottom on new arrival
 *    UNLESS the operator scrolled up (then we show a small "↓ Nouveaux
 *    messages" pill at the bottom).
 *  - Sender's own messages render right-aligned + teranga-gold tinted.
 *  - Author name + relative timestamp grouped per minute (don't repeat
 *    the same author header for adjacent rapid messages).
 *  - Empty state: "Premier message — la radio démarre ici" — positive
 *    framing.
 *  - Send box: textarea (multi-line OK), Enter sends, Shift+Enter newline.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowDown, Radio, Send } from "lucide-react";
import { Button, Card, CardContent, InlineErrorBanner, Textarea } from "@teranga/shared-ui";
import { useErrorHandler, type ResolvedError } from "@/hooks/use-error-handler";
import { cn } from "@/lib/utils";
import { useStaffMessages, usePostStaffMessage } from "@/hooks/use-live-ops";
import { useStaffRadioStream } from "@/hooks/use-staff-radio-stream";
import { formatTime } from "./helpers";
import type { StaffMessage } from "@teranga/shared-types";

export { formatTime };

export interface StaffRadioProps {
  eventId: string;
  /** Logged-in user uid — used to right-align own messages. */
  currentUserId?: string;
  className?: string;
}

const SCROLL_THRESHOLD_PX = 80;

export function StaffRadio({ eventId, currentUserId, className }: StaffRadioProps) {
  // Realtime listener (preferred). Falls back to the React Query cold
  // start when the listener hasn't received its first snapshot yet.
  const stream = useStaffRadioStream(eventId);
  const { data: cachedMessages } = useStaffMessages(eventId);
  const post = usePostStaffMessage(eventId);
  const { resolve: resolveError } = useErrorHandler();

  const messages = useMemo<StaffMessage[]>(() => {
    if (stream.isReady) return stream.messages;
    if (!cachedMessages) return [];
    // Cold-start fallback — sort ASC (oldest at top) so the layout
    // matches the realtime stream. The API returns DESC by default.
    return [...cachedMessages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [stream.isReady, stream.messages, cachedMessages]);

  const [draft, setDraft] = useState("");
  const [error, setError] = useState<ResolvedError | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  // Auto-scroll to bottom when new messages arrive UNLESS the user
  // scrolled up (we surface a "jump to bottom" pill in that case).
  const lastIdRef = useRef<string | null>(null);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    if (lastIdRef.current === last.id) return;
    lastIdRef.current = last.id;
    const el = scrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD_PX;
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
      setShowJumpToBottom(false);
    } else {
      setShowJumpToBottom(true);
    }
  }, [messages]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD_PX;
    if (isNearBottom) setShowJumpToBottom(false);
  };

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setShowJumpToBottom(false);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    const body = draft.trim();
    if (body.length === 0) return;
    try {
      await post.mutateAsync({ body });
      setDraft("");
      // Force scroll to the bottom for our own messages — we just sent
      // it, the UI should reflect that intent regardless of scroll pos.
      setTimeout(jumpToBottom, 50);
    } catch (err) {
      setError(resolveError(err));
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardContent className="p-4 flex flex-col gap-3 flex-1 min-h-0">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Radio className="h-4 w-4 text-emerald-500" aria-hidden="true" />
            Radio staff
          </h2>
          <span
            className={cn(
              "text-[11px] flex items-center gap-1.5",
              stream.isReady ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                stream.isReady ? "bg-emerald-500" : "bg-muted-foreground/40",
              )}
              aria-hidden="true"
            />
            {stream.isReady ? "En direct" : "Connexion…"}
          </span>
        </div>

        {stream.error && (
          <InlineErrorBanner
            severity="warning"
            title="Connexion temps réel interrompue"
            description={stream.error}
          />
        )}

        {error && (
          <InlineErrorBanner
            title={error.title}
            description={error.description}
            onDismiss={() => setError(null)}
            dismissLabel="Fermer"
          />
        )}

        {/* Message list */}
        <div className="relative flex-1 min-h-[200px]">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="absolute inset-0 overflow-y-auto pr-1 space-y-2"
            role="log"
            aria-live="polite"
            aria-label="Messages staff"
          >
            {messages.length === 0 ? (
              <div className="h-full min-h-[160px] flex items-center justify-center">
                <p className="text-xs text-muted-foreground">
                  Premier message — la radio démarre ici.
                </p>
              </div>
            ) : (
              messages.map((m, i) => {
                const prev = messages[i - 1];
                const isOwn = currentUserId === m.authorId;
                // Group consecutive messages from the same author within
                // 60s under one header.
                const sameAuthor = prev && prev.authorId === m.authorId;
                const sameMinute =
                  prev &&
                  Math.abs(new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime()) <
                    60_000;
                const showHeader = !(sameAuthor && sameMinute);
                return (
                  <div
                    key={m.id}
                    className={cn("flex flex-col", isOwn ? "items-end" : "items-start")}
                  >
                    {showHeader && (
                      <div
                        className={cn(
                          "text-[10px] text-muted-foreground mb-0.5 flex gap-2",
                          isOwn && "flex-row-reverse",
                        )}
                      >
                        <span className="font-medium">{m.authorName}</span>
                        <span>·</span>
                        <span>{formatTime(m.createdAt)}</span>
                      </div>
                    )}
                    <div
                      className={cn(
                        "max-w-[80%] rounded-lg px-3 py-1.5 text-sm whitespace-pre-wrap break-words",
                        isOwn
                          ? "bg-teranga-gold/15 text-foreground border border-teranga-gold/30"
                          : "bg-muted text-foreground border border-border",
                      )}
                    >
                      {m.body}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {showJumpToBottom && (
            <button
              type="button"
              onClick={jumpToBottom}
              className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-full bg-foreground text-background text-xs px-3 py-1 shadow"
            >
              <ArrowDown className="h-3 w-3" aria-hidden="true" />
              Nouveaux messages
            </button>
          )}
        </div>

        {/* Compose */}
        <form onSubmit={submit} className="space-y-1.5">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Tapez un message — Entrée pour envoyer"
            rows={2}
            maxLength={1000}
            aria-label="Message à diffuser sur la radio staff"
          />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">
              Entrée pour envoyer · Maj+Entrée pour aller à la ligne · {draft.length}/1000
            </p>
            <Button type="submit" size="sm" disabled={post.isPending || draft.trim().length === 0}>
              <Send className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              {post.isPending ? "Envoi…" : "Envoyer"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
