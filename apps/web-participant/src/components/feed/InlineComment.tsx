"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { feedApi } from "@/lib/api-client";
import type { FeedComment } from "@teranga/shared-types";

function formatCommentDate(iso: string) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface InlineCommentProps {
  comment: FeedComment;
  eventId: string;
  postId: string;
  isOwn: boolean;
}

export function InlineComment({ comment, eventId, postId, isOwn }: InlineCommentProps) {
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
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
        {comment.authorName[0]?.toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="font-medium text-foreground text-xs">{comment.authorName}</span>
          <span className="text-xs text-muted-foreground">
            {formatCommentDate(comment.createdAt)}
          </span>
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
