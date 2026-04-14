"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Heart, MessageCircle, Send, Pin, Megaphone, Check, X } from "lucide-react";
import { feedApi } from "@/lib/api-client";
import { PostMenu } from "./PostMenu";
import { DeleteConfirm } from "./DeleteConfirm";
import { InlineComment } from "./InlineComment";
import { ImageGallery } from "./ImageGallery";
import type { FeedPost } from "@teranga/shared-types";
import { Badge } from "@teranga/shared-ui";

function formatPostDate(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface FeedPostCardProps {
  post: FeedPost;
  eventId: string;
  currentUserId: string | undefined;
}

export function FeedPostCard({ post, eventId, currentUserId }: FeedPostCardProps) {
  const qc = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showAllComments, setShowAllComments] = useState(false);
  const [commentText, setCommentText] = useState("");

  const isOwn = currentUserId !== undefined && post.authorId === currentUserId;
  const isLiked = currentUserId !== undefined && post.likedByIds?.includes(currentUserId);

  // Fetch comments only when expanded
  const { data: commentsData } = useQuery({
    queryKey: ["comments", eventId, post.id],
    queryFn: () => feedApi.listComments(eventId, post.id),
    enabled: showComments,
  });

  const allComments = commentsData?.data ?? [];
  const visibleComments = showAllComments ? allComments : allComments.slice(0, 3);
  const hiddenCount = allComments.length - 3;

  const toggleLike = useMutation({
    mutationFn: () => feedApi.toggleLike(eventId, post.id),
    onMutate: async () => {
      // Optimistic update — avoid full feed refetch on like toggle
      await qc.cancelQueries({ queryKey: ["feed", eventId] });
      const previous = qc.getQueryData(["feed", eventId]);
      qc.setQueryData(["feed", eventId], (old: unknown) => {
        if (!old || typeof old !== "object" || !("pages" in old)) return old;
        const typed = old as { pages: { data: FeedPost[]; meta: unknown }[] };
        return {
          ...typed,
          pages: typed.pages.map((page) => ({
            ...page,
            data: page.data.map((p) =>
              p.id === post.id
                ? {
                    ...p,
                    likeCount: isLiked ? p.likeCount - 1 : p.likeCount + 1,
                    likedByIds: isLiked
                      ? (p.likedByIds ?? []).filter((id) => id !== currentUserId)
                      : [...(p.likedByIds ?? []), currentUserId!],
                  }
                : p,
            ),
          })),
        };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(["feed", eventId], context.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["feed", eventId] });
    },
  });

  const updatePost = useMutation({
    mutationFn: (content: string) => feedApi.updatePost(eventId, post.id, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed", eventId] });
      setIsEditing(false);
    },
  });

  const deletePost = useMutation({
    mutationFn: () => feedApi.deletePost(eventId, post.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed", eventId] });
    },
  });

  const addComment = useMutation({
    mutationFn: (content: string) => feedApi.addComment(eventId, post.id, { content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed", eventId] });
      qc.invalidateQueries({ queryKey: ["comments", eventId, post.id] });
      setCommentText("");
      setShowComments(true);
    },
  });

  const handleSubmitComment = useCallback(() => {
    const trimmed = commentText.trim();
    if (trimmed) addComment.mutate(trimmed);
  }, [commentText, addComment]);

  // Card styling based on type
  const cardClass = post.isAnnouncement
    ? "border-l-4 border-l-blue-500 border border-blue-200 bg-blue-50/30 dark:border-blue-800 dark:bg-blue-950/20"
    : post.isPinned
      ? "border-l-4 border-l-amber-500 border border-amber-200 bg-amber-50/30 dark:border-amber-800 dark:bg-amber-950/20"
      : "border border-border";

  return (
    <div className={`bg-card rounded-xl p-5 ${cardClass}`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary overflow-hidden">
          {post.authorPhotoURL ? (
            <img
              src={post.authorPhotoURL}
              alt={post.authorName ?? "Auteur"}
              className="h-full w-full object-cover"
            />
          ) : (
            <span>{post.authorName[0]?.toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground truncate">
              {post.authorName}
            </span>
            {post.isAnnouncement && (
              <Badge variant="info" className="gap-1">
                <Megaphone className="h-3 w-3" aria-hidden="true" />
                Annonce
              </Badge>
            )}
            {post.isPinned && (
              <Badge variant="warning" className="gap-1">
                <Pin className="h-3 w-3" aria-hidden="true" />
                Épinglé
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{formatPostDate(post.createdAt)}</span>
        </div>
        {isOwn && !isEditing && (
          <PostMenu
            onEdit={() => {
              setEditContent(post.content);
              setIsEditing(true);
            }}
            onDelete={() => setShowDeleteConfirm(true)}
          />
        )}
      </div>

      {/* Content or Edit mode */}
      {isEditing ? (
        <div className="mb-4">
          <label htmlFor={`edit-${post.id}`} className="sr-only">
            Modifier le message
          </label>
          <textarea
            id={`edit-${post.id}`}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 mb-2"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => editContent.trim() && updatePost.mutate(editContent.trim())}
              disabled={updatePost.isPending || !editContent.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {updatePost.isPending ? "..." : "Enregistrer"}
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-foreground whitespace-pre-wrap mb-1">{post.content}</p>
      )}

      {/* Image gallery */}
      {!isEditing && post.mediaURLs && post.mediaURLs.length > 0 && (
        <ImageGallery images={post.mediaURLs} />
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <DeleteConfirm
          label="Voulez-vous vraiment supprimer cette publication ?"
          onConfirm={() => deletePost.mutate()}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {/* Like & Comment actions */}
      <div className="flex items-center gap-4 border-t border-border pt-3 mt-3">
        <button
          onClick={() => toggleLike.mutate()}
          className={`inline-flex items-center gap-1.5 text-sm transition-all ${
            isLiked
              ? "text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
              : "text-muted-foreground hover:text-red-500 dark:hover:text-red-400"
          }`}
          aria-label={isLiked ? "Retirer le j'aime" : "J'aime"}
        >
          <Heart
            className={`h-4 w-4 transition-transform ${isLiked ? "fill-current scale-110" : ""}`}
          />
          {post.likeCount > 0 && post.likeCount}
        </button>
        <button
          onClick={() => setShowComments(!showComments)}
          className={`inline-flex items-center gap-1.5 text-sm transition-colors ${
            showComments ? "text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
          aria-label={showComments ? "Masquer les commentaires" : "Afficher les commentaires"}
        >
          <MessageCircle className="h-4 w-4" />
          {post.commentCount > 0 && post.commentCount}
        </button>
      </div>

      {/* Comments section (collapsible) */}
      {showComments && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {/* Existing comments */}
          {visibleComments.length > 0 && (
            <div className="space-y-2">
              {visibleComments.map((comment) => (
                <InlineComment
                  key={comment.id}
                  comment={comment}
                  eventId={eventId}
                  postId={post.id}
                  isOwn={currentUserId !== undefined && comment.authorId === currentUserId}
                />
              ))}
              {!showAllComments && hiddenCount > 0 && (
                <button
                  onClick={() => setShowAllComments(true)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Voir tous les commentaires ({allComments.length})
                </button>
              )}
              {showAllComments && allComments.length > 3 && (
                <button
                  onClick={() => setShowAllComments(false)}
                  className="text-xs font-medium text-muted-foreground hover:underline"
                >
                  Masquer
                </button>
              )}
            </div>
          )}

          {/* Comment input */}
          <div className="flex gap-2">
            <label htmlFor={`comment-input-${post.id}`} className="sr-only">
              Écrire un commentaire
            </label>
            <input
              id={`comment-input-${post.id}`}
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Écrire un commentaire..."
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              onKeyDown={(e) => {
                if (e.key === "Enter" && commentText.trim()) {
                  handleSubmitComment();
                }
              }}
            />
            <button
              onClick={handleSubmitComment}
              disabled={!commentText.trim() || addComment.isPending}
              className="bg-primary text-white rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              aria-label="Envoyer le commentaire"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
