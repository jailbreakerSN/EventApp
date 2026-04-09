"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { messagingApi } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import { MessageSquare, Send, Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { Conversation, Message } from "@teranga/shared-types";

/** Relative time in French */
function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "A l'instant";
  if (diffMin < 60) return `Il y a ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Il y a ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return "Hier";
  if (diffD < 7) return `Il y a ${diffD}j`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Truncate a participant ID for display when no name is available */
function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}...${id.slice(-4)}`;
}

/** Get the display name for the other participant in a conversation */
function getOtherParticipantLabel(conv: Conversation, currentUserId: string): string {
  const otherId = conv.participantIds.find((id) => id !== currentUserId) ?? conv.participantIds[0];
  return truncateId(otherId ?? "Inconnu");
}

/** Group consecutive messages from same sender */
interface MessageGroup {
  senderId: string;
  messages: Message[];
}

function groupMessages(msgs: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const msg of msgs) {
    const last = groups[groups.length - 1];
    if (last && last.senderId === msg.senderId) {
      last.messages.push(msg);
    } else {
      groups.push({ senderId: msg.senderId, messages: [msg] });
    }
  }
  return groups;
}

export default function MessagesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const currentUserId = user?.uid ?? "";
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: convData, isLoading: loadingConvs } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => messagingApi.listConversations(),
  });

  const { data: messagesData, isLoading: loadingMsgs } = useQuery({
    queryKey: ["messages", selectedConv],
    queryFn: () => messagingApi.listMessages(selectedConv!),
    enabled: !!selectedConv,
  });

  const sendMessage = useMutation({
    mutationFn: (content: string) =>
      messagingApi.sendMessage(selectedConv!, { content, type: "text" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages", selectedConv] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      setMessageText("");
    },
  });

  const markAsRead = useMutation({
    mutationFn: (convId: string) => messagingApi.markAsRead(convId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const conversations = convData?.data ?? [];
  const messages = messagesData?.data ?? [];

  // Sort conversations by most recent message (latest first)
  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => {
      const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : new Date(a.createdAt).getTime();
      const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : new Date(b.createdAt).getTime();
      return bTime - aTime;
    });
  }, [conversations]);

  // Reversed messages for chronological display (oldest first)
  const chronologicalMessages = useMemo(() => [...messages].reverse(), [messages]);
  const messageGroups = useMemo(() => groupMessages(chronologicalMessages), [chronologicalMessages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageGroups]);

  // Selected conversation data
  const selectedConvData = sortedConversations.find((c) => c.id === selectedConv);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Link
        href="/my-events"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Mes événements
      </Link>

      <h1 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-3">
        <MessageSquare className="h-6 w-6 text-primary" />
        Messages
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[500px]">
        {/* Conversation list */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Conversations</h2>
          </div>
          {loadingConvs ? (
            <div className="animate-pulse divide-y divide-border">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-muted rounded w-2/3"></div>
                      <div className="h-3 bg-muted rounded w-4/5"></div>
                    </div>
                    <div className="h-3 bg-muted rounded w-12"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : sortedConversations.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Aucune conversation
            </div>
          ) : (
            <div className="divide-y divide-border overflow-y-auto max-h-[450px]">
              {sortedConversations.map((conv) => {
                const unreadCount = conv.unreadCounts?.[currentUserId] ?? 0;
                const hasUnread = unreadCount > 0;
                const otherName = getOtherParticipantLabel(conv, currentUserId);

                return (
                  <button
                    key={conv.id}
                    onClick={() => {
                      setSelectedConv(conv.id);
                      if (hasUnread) markAsRead.mutate(conv.id);
                    }}
                    className={`w-full text-left p-4 hover:bg-muted transition-colors ${
                      selectedConv === conv.id ? "bg-primary/5 border-l-2 border-l-primary" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm truncate ${hasUnread ? "font-bold text-foreground" : "font-medium text-foreground"}`}>
                          {otherName}
                        </p>
                        {conv.lastMessage && (
                          <p className={`text-xs truncate mt-0.5 ${hasUnread ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                            {conv.lastMessage}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        {conv.lastMessageAt && (
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {relativeTime(conv.lastMessageAt)}
                          </span>
                        )}
                        {hasUnread && (
                          <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-primary text-[10px] font-bold text-white">
                            {unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Message thread */}
        <div className="md:col-span-2 bg-card rounded-xl border border-border flex flex-col">
          {!selectedConv ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              S\u00e9lectionnez une conversation
            </div>
          ) : (
            <>
              {/* Thread header */}
              {selectedConvData && (
                <div className="px-4 py-3 border-b border-border flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                    {getOtherParticipantLabel(selectedConvData, currentUserId).charAt(0).toUpperCase()}
                  </div>
                  <span className="font-medium text-sm text-foreground">
                    {getOtherParticipantLabel(selectedConvData, currentUserId)}
                  </span>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {loadingMsgs ? (
                  <div className="animate-pulse space-y-4 py-4">
                    <div className="flex justify-start">
                      <div className="space-y-1.5 max-w-[60%]">
                        <div className="h-3 bg-muted rounded w-16"></div>
                        <div className="h-10 bg-muted rounded-r-lg rounded-tl-lg w-48"></div>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <div className="space-y-1.5 max-w-[60%]">
                        <div className="h-3 bg-muted rounded w-12 ml-auto"></div>
                        <div className="h-10 bg-muted rounded-l-lg rounded-tr-lg w-56"></div>
                      </div>
                    </div>
                    <div className="flex justify-start">
                      <div className="space-y-1.5 max-w-[60%]">
                        <div className="h-3 bg-muted rounded w-16"></div>
                        <div className="h-10 bg-muted rounded-r-lg rounded-tl-lg w-40"></div>
                      </div>
                    </div>
                  </div>
                ) : chronologicalMessages.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    Aucun message. Commencez la conversation !
                  </div>
                ) : (
                  messageGroups.map((group, gi) => {
                    const isOwn = group.senderId === currentUserId;
                    const senderLabel = isOwn ? "Vous" : truncateId(group.senderId);

                    return (
                      <div key={`group-${gi}`} className="space-y-1">
                        {/* Timestamp separator between groups */}
                        {gi > 0 && (
                          <div className="flex items-center justify-center my-2">
                            <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                              {formatTimestamp(group.messages[0].createdAt)}
                            </span>
                          </div>
                        )}
                        {gi === 0 && (
                          <div className="flex items-center justify-center mb-2">
                            <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                              {formatTimestamp(group.messages[0].createdAt)}
                            </span>
                          </div>
                        )}

                        {/* Sender name */}
                        <p className={`text-[11px] font-medium mb-0.5 ${
                          isOwn ? "text-right text-primary" : "text-left text-muted-foreground"
                        }`}>
                          {senderLabel}
                        </p>

                        {/* Message bubbles */}
                        {group.messages.map((msg, mi) => (
                          <div
                            key={msg.id}
                            className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`max-w-[75%] px-3 py-2 ${
                                isOwn
                                  ? "bg-primary text-white rounded-l-lg rounded-tr-lg"
                                  : "bg-accent text-foreground rounded-r-lg rounded-tl-lg"
                              } ${
                                mi === 0 ? "" : isOwn ? "rounded-tr-md" : "rounded-tl-md"
                              }`}
                            >
                              <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                              {mi === group.messages.length - 1 && (
                                <p className={`text-[10px] mt-1 ${
                                  isOwn ? "text-white/70" : "text-muted-foreground"
                                }`}>
                                  {new Date(msg.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message input */}
              <div className="border-t border-border p-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="\u00c9crire un message..."
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && messageText.trim()) {
                        sendMessage.mutate(messageText.trim());
                      }
                    }}
                  />
                  <button
                    onClick={() => messageText.trim() && sendMessage.mutate(messageText.trim())}
                    disabled={sendMessage.isPending || !messageText.trim()}
                    className="bg-primary text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50 hover:bg-primary/90 transition-colors"
                    aria-label="Envoyer le message"
                  >
                    {sendMessage.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
