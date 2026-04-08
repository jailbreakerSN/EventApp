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
    mutationFn: (content: string) => feedApi.create(eventId, { content, mediaURLs: [], isAnnouncement: false }),
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
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Retour
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <MessageSquare className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Feed</h1>
          {event && <p className="text-sm text-muted-foreground">{event.title}</p>}
        </div>
      </div>

      {/* New post */}
      <div className="bg-card rounded-xl border border-border p-4 mb-6">
        <label htmlFor="new-post-content" className="sr-only">Nouveau message</label>
        <textarea
          id="new-post-content"
          value={newPost}
          onChange={(e) => setNewPost(e.target.value)}
          placeholder="Partagez quelque chose..."
          rows={3}
          aria-label="Nouveau message"
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 mb-3"
        />
        <div className="flex justify-end">
          <button
            onClick={() => newPost.trim() && createPost.mutate(newPost.trim())}
            disabled={createPost.isPending || !newPost.trim()}
            aria-label={createPost.isPending ? "Publication en cours..." : "Publier le message"}
            className="bg-primary text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {createPost.isPending ? "..." : "Publier"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16" role="status" aria-label="Chargement du feed...">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Chargement du feed...</span>
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>Aucune publication pour le moment</p>
          <p className="text-sm mt-1">Soyez le premier à partager !</p>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <div
              key={post.id}
              className={`bg-card rounded-xl border p-5 ${post.isPinned ? "border-amber-200 bg-amber-50/30" : "border-border"}`}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                  {post.authorName[0]?.toUpperCase()}
                </div>
                <div>
                  <span className="text-sm font-medium text-foreground">{post.authorName}</span>
                  <span className="text-xs text-muted-foreground ml-2">{formatDate(post.createdAt)}</span>
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

              <p className="text-sm text-foreground whitespace-pre-wrap mb-4">{post.content}</p>

              <div className="flex items-center gap-4 border-t border-border pt-3">
                <button
                  onClick={() => toggleLike.mutate(post.id)}
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-red-500 transition-colors"
                  aria-label="J'aime"
                >
                  <Heart className="h-4 w-4" />
                  {post.likeCount}
                </button>
                <button
                  onClick={() => setCommentingOn(commentingOn === post.id ? null : post.id)}
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
                  aria-label="Commenter"
                >
                  <MessageCircle className="h-4 w-4" />
                  {post.commentCount}
                </button>
              </div>

              {commentingOn === post.id && (
                <div className="mt-3 flex gap-2">
                  <label htmlFor={`comment-input-${post.id}`} className="sr-only">Écrire un commentaire</label>
                  <input
                    id={`comment-input-${post.id}`}
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Écrire un commentaire..."
                    className="flex-1 rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && commentText.trim()) {
                        addComment.mutate({ postId: post.id, content: commentText.trim() });
                      }
                    }}
                  />
                  <button
                    onClick={() => commentText.trim() && addComment.mutate({ postId: post.id, content: commentText.trim() })}
                    disabled={!commentText.trim()}
                    className="bg-primary text-white rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                    aria-label="Envoyer le commentaire"
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
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
