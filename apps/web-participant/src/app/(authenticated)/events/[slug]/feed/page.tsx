"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { feedApi, eventsApi } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import {
  MessageSquare,
  Heart,
  MessageCircle,
  Loader2,
  ArrowLeft,
  Send,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
  Check,
} from "lucide-react";
import Link from "next/link";
import type { FeedPost, FeedComment } from "@teranga/shared-types";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Post Menu (Edit / Delete) ──────────────────────────────────────────────

function PostMenu({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative ml-auto">
      <button
        onClick={() => setOpen(!open)}
        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        aria-label="Options du post"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-border bg-card shadow-lg py-1">
            <button
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Modifier
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-muted transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Supprimer
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Delete Confirm Dialog ──────────────────────────────────────────────────

function DeleteConfirm({
  label,
  onConfirm,
  onCancel,
}: {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
      <p className="text-sm text-foreground">{label}</p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={onConfirm}
          className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-white hover:bg-destructive/90"
        >
          Confirmer
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

// ─── Inline Comment ─────────────────────────────────────────────────────────

function InlineComment({
  comment,
  eventId,
  postId,
  isOwn,
}: {
  comment: FeedComment;
  eventId: string;
  postId: string;
  isOwn: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const qc = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: () => feedApi.deleteComment(eventId, postId, comment.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed", eventId] });
      qc.invalidateQueries({ queryKey: ["comments", eventId, postId] });
    },
  });

  return (
    <div className="flex gap-2 text-sm group">
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
        {comment.authorName[0]?.toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="font-medium text-foreground text-xs">{comment.authorName}</span>
          <span className="text-xs text-muted-foreground">{formatDate(comment.createdAt)}</span>
          {isOwn && !confirmDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="ml-auto opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
              aria-label="Supprimer le commentaire"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
        <p className="text-muted-foreground text-xs mt-0.5">{comment.content}</p>
        {confirmDelete && (
          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="text-xs text-destructive hover:underline"
            >
              {deleteMutation.isPending ? "..." : "Supprimer"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-muted-foreground hover:underline"
            >
              Annuler
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Feed Post Card ─────────────────────────────────────────────────────────

function FeedPostCard({
  post,
  eventId,
  currentUserId,
}: {
  post: FeedPost;
  eventId: string;
  currentUserId: string | undefined;
}) {
  const qc = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAllComments, setShowAllComments] = useState(false);
  const [commentText, setCommentText] = useState("");

  const isOwn = currentUserId !== undefined && post.authorId === currentUserId;
  const isLiked = currentUserId !== undefined && post.likedByIds?.includes(currentUserId);

  // Fetch comments for this post
  const { data: commentsData } = useQuery({
    queryKey: ["comments", eventId, post.id],
    queryFn: () => feedApi.listComments(eventId, post.id),
    enabled: !!eventId,
  });

  const allComments = commentsData?.data ?? [];
  const visibleComments = showAllComments ? allComments : allComments.slice(0, 2);
  const hiddenCount = allComments.length - 2;

  const toggleLike = useMutation({
    mutationFn: () => feedApi.toggleLike(eventId, post.id),
    onSuccess: () => {
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
    mutationFn: (content: string) =>
      feedApi.addComment(eventId, post.id, { content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed", eventId] });
      qc.invalidateQueries({ queryKey: ["comments", eventId, post.id] });
      setCommentText("");
    },
  });

  const handleSubmitComment = useCallback(() => {
    const trimmed = commentText.trim();
    if (trimmed) addComment.mutate(trimmed);
  }, [commentText, addComment]);

  return (
    <div
      className={`bg-card rounded-xl border p-5 ${post.isPinned ? "border-amber-200 bg-amber-50/30" : "border-border"}`}
    >
      {/* Header */}
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
            Epingle
          </span>
        )}
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
          <label htmlFor={`edit-${post.id}`} className="sr-only">Modifier le message</label>
          <textarea
            id={`edit-${post.id}`}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 mb-2"
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
        <p className="text-sm text-foreground whitespace-pre-wrap mb-4">{post.content}</p>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <DeleteConfirm
          label="Voulez-vous vraiment supprimer cette publication ?"
          onConfirm={() => deletePost.mutate()}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {/* Like & Comment counts */}
      <div className="flex items-center gap-4 border-t border-border pt-3">
        <button
          onClick={() => toggleLike.mutate()}
          className={`inline-flex items-center gap-1.5 text-sm transition-colors ${
            isLiked
              ? "text-red-500 hover:text-red-600"
              : "text-muted-foreground hover:text-red-500"
          }`}
          aria-label={isLiked ? "Retirer le j'aime" : "J'aime"}
        >
          <Heart
            className={`h-4 w-4 ${isLiked ? "fill-current" : ""}`}
          />
          {post.likeCount}
        </button>
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <MessageCircle className="h-4 w-4" />
          {post.commentCount}
        </span>
      </div>

      {/* Inline comments */}
      {allComments.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
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
          {showAllComments && allComments.length > 2 && (
            <button
              onClick={() => setShowAllComments(false)}
              className="text-xs font-medium text-muted-foreground hover:underline"
            >
              Masquer
            </button>
          )}
        </div>
      )}

      {/* Always-visible comment input */}
      <div className="mt-3 flex gap-2">
        <label htmlFor={`comment-input-${post.id}`} className="sr-only">
          Ecrire un commentaire
        </label>
        <input
          id={`comment-input-${post.id}`}
          type="text"
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder="Ecrire un commentaire..."
          className="flex-1 rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
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
  );
}

// ─── Feed Page ──────────────────────────────────────────────────────────────

export default function FeedPage() {
  const { slug: eventId } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [newPost, setNewPost] = useState("");

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
    mutationFn: (content: string) =>
      feedApi.create(eventId, { content, mediaURLs: [], isAnnouncement: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed", eventId] });
      setNewPost("");
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
        <label htmlFor="new-post-content" className="sr-only">
          Nouveau message
        </label>
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
            aria-label={
              createPost.isPending ? "Publication en cours..." : "Publier le message"
            }
            className="bg-primary text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-2"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {createPost.isPending ? "..." : "Publier"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div
          className="flex items-center justify-center py-16"
          role="status"
          aria-label="Chargement du feed..."
        >
          <Loader2
            className="h-6 w-6 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
          <span className="sr-only">Chargement du feed...</span>
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>Aucune publication pour le moment</p>
          <p className="text-sm mt-1">Soyez le premier a partager !</p>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <FeedPostCard
              key={post.id}
              post={post}
              eventId={eventId}
              currentUserId={user?.uid}
            />
          ))}
        </div>
      )}
    </div>
  );
}
