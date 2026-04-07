"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { feedApi, eventsApi } from "@/lib/api-client";
import { MessageSquare, Heart, MessageCircle, Loader2, ArrowLeft, Send } from "lucide-react";
import Link from "next/link";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function FeedPage() {
  const { slug: eventId } = useParams<{ slug: string }>();
  const qc = useQueryClient();
  const [newPost, setNewPost] = useState("");
  const [commentingOn, setCommentingOn] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");

  const { data: eventData } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => eventsApi.getById(eventId),
    enabled: !!eventId,
  });

  const { data: feedData, isLoading } = useQuery({
    queryKey: ["feed", eventId],
    queryFn: () => feedApi.list(eventId),
    enabled: !!eventId,
  });

  const createPost = useMutation({
    mutationFn: (content: string) => feedApi.create(eventId, { content, isAnnouncement: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed", eventId] });
      setNewPost("");
    },
  });

  const toggleLike = useMutation({
    mutationFn: (postId: string) => feedApi.toggleLike(eventId, postId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed", eventId] });
    },
  });

  const addComment = useMutation({
    mutationFn: ({ postId, content }: { postId: string; content: string }) =>
      feedApi.addComment(eventId, postId, { content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed", eventId] });
      setCommentingOn(null);
      setCommentText("");
    },
  });

  const event = eventData?.data;
  const posts = feedData?.data ?? [];

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link
        href={event ? `/events/${event.slug}` : "/events"}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Retour
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <MessageSquare className="h-6 w-6 text-[#1A1A2E]" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Feed</h1>
          {event && <p className="text-sm text-gray-500">{event.title}</p>}
        </div>
      </div>

      {/* New post */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-6">
        <textarea
          value={newPost}
          onChange={(e) => setNewPost(e.target.value)}
          placeholder="Partagez quelque chose..."
          rows={3}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 mb-3"
        />
        <div className="flex justify-end">
          <button
            onClick={() => newPost.trim() && createPost.mutate(newPost.trim())}
            disabled={createPost.isPending || !newPost.trim()}
            className="bg-[#1A1A2E] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#16213E] disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Send className="h-4 w-4" />
            {createPost.isPending ? "..." : "Publier"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>Aucune publication pour le moment</p>
          <p className="text-sm mt-1">Soyez le premier à partager !</p>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <div
              key={post.id}
              className={`bg-white rounded-xl border p-5 ${post.isPinned ? "border-amber-200 bg-amber-50/30" : "border-gray-100"}`}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-[#1A1A2E]/10 flex items-center justify-center text-xs font-medium text-[#1A1A2E]">
                  {post.authorName[0]?.toUpperCase()}
                </div>
                <div>
                  <span className="text-sm font-medium text-gray-900">{post.authorName}</span>
                  <span className="text-xs text-gray-400 ml-2">{formatDate(post.createdAt)}</span>
                </div>
                {post.isAnnouncement && (
                  <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full ml-auto">
                    Annonce
                  </span>
                )}
                {post.isPinned && (
                  <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full">
                    Épinglé
                  </span>
                )}
              </div>

              <p className="text-sm text-gray-700 whitespace-pre-wrap mb-4">{post.content}</p>

              <div className="flex items-center gap-4 border-t border-gray-50 pt-3">
                <button
                  onClick={() => toggleLike.mutate(post.id)}
                  className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-500 transition-colors"
                >
                  <Heart className="h-4 w-4" />
                  {post.likeCount}
                </button>
                <button
                  onClick={() => setCommentingOn(commentingOn === post.id ? null : post.id)}
                  className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#1A1A2E] transition-colors"
                >
                  <MessageCircle className="h-4 w-4" />
                  {post.commentCount}
                </button>
              </div>

              {commentingOn === post.id && (
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Écrire un commentaire..."
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && commentText.trim()) {
                        addComment.mutate({ postId: post.id, content: commentText.trim() });
                      }
                    }}
                  />
                  <button
                    onClick={() => commentText.trim() && addComment.mutate({ postId: post.id, content: commentText.trim() })}
                    disabled={!commentText.trim()}
                    className="bg-[#1A1A2E] text-white rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
