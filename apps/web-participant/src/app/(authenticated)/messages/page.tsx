"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { messagingApi } from "@/lib/api-client";
import { MessageSquare, Send, Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MessagesPage() {
  const qc = useQueryClient();
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");

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

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Link
        href="/my-events"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Mes événements
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-3">
        <MessageSquare className="h-6 w-6 text-[#1A1A2E]" />
        Messages
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[500px]">
        {/* Conversation list */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Conversations</h2>
          </div>
          {loadingConvs ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              Aucune conversation
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => {
                    setSelectedConv(conv.id);
                    markAsRead.mutate(conv.id);
                  }}
                  className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${selectedConv === conv.id ? "bg-[#1A1A2E]/5" : ""}`}
                >
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {conv.participantIds.join(", ")}
                  </p>
                  {conv.lastMessage && (
                    <p className="text-xs text-gray-500 truncate mt-0.5">{conv.lastMessage}</p>
                  )}
                  {conv.lastMessageAt && (
                    <p className="text-xs text-gray-400 mt-1">{formatDate(conv.lastMessageAt)}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Message thread */}
        <div className="md:col-span-2 bg-white rounded-xl border border-gray-100 flex flex-col">
          {!selectedConv ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              Sélectionnez une conversation
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {loadingMsgs ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    Aucun message
                  </div>
                ) : (
                  [...messages].reverse().map((msg) => (
                    <div key={msg.id} className="flex flex-col">
                      <div className="flex items-end gap-2">
                        <div className="bg-gray-100 rounded-lg px-3 py-2 max-w-[80%]">
                          <p className="text-sm text-gray-800">{msg.content}</p>
                          <p className="text-xs text-gray-400 mt-1">{formatDate(msg.createdAt)}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="border-t border-gray-100 p-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="Écrire un message..."
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && messageText.trim()) {
                        sendMessage.mutate(messageText.trim());
                      }
                    }}
                  />
                  <button
                    onClick={() => messageText.trim() && sendMessage.mutate(messageText.trim())}
                    disabled={sendMessage.isPending || !messageText.trim()}
                    className="bg-[#1A1A2E] text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
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
