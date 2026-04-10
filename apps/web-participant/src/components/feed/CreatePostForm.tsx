"use client";

import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { feedApi } from "@/lib/api-client";
import { useFeedUpload } from "@/hooks/use-feed-upload";
import { ImagePicker } from "./ImagePicker";

interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

interface CreatePostFormProps {
  eventId: string;
  user: AuthUser | null;
}

const MAX_CONTENT_LENGTH = 2000;
const CHAR_WARNING_THRESHOLD = 1500;

export function CreatePostForm({ eventId, user }: CreatePostFormProps) {
  const qc = useQueryClient();
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { images, addImages, removeImage, clearAll, uploadAll, isUploading, canAddMore } =
    useFeedUpload(eventId);

  const createPost = useMutation({
    mutationFn: (data: { content: string; mediaURLs: string[] }) =>
      feedApi.create(eventId, {
        content: data.content,
        mediaURLs: data.mediaURLs,
        isAnnouncement: false,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed", eventId] });
      setContent("");
      clearAll();
    },
  });

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed && images.length === 0) return;

    setIsSubmitting(true);
    try {
      // Upload images first if any
      let mediaURLs: string[] = [];
      if (images.length > 0) {
        mediaURLs = await uploadAll();
      }

      await createPost.mutateAsync({ content: trimmed, mediaURLs });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la publication");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddImages = (files: FileList): string[] => {
    const errors = addImages(files);
    errors.forEach((err) => toast.error(err));
    return errors;
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleAddImages(e.target.files);
      e.target.value = "";
    }
  };

  const charCount = content.length;
  const showCharCount = charCount > CHAR_WARNING_THRESHOLD;
  const isOverLimit = charCount > MAX_CONTENT_LENGTH;
  const isBusy = isSubmitting || isUploading || createPost.isPending;
  const canSubmit = (content.trim() || images.length > 0) && !isOverLimit && !isBusy;

  return (
    <div className="bg-card rounded-xl border border-border p-4 mb-6">
      <div className="flex gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground overflow-hidden">
          {user?.photoURL ? (
            <img src={user.photoURL} alt="" className="h-full w-full object-cover" />
          ) : (
            <span>{user?.displayName?.[0]?.toUpperCase() ?? "?"}</span>
          )}
        </div>
        <div className="flex-1">
          <label htmlFor="new-post-content" className="sr-only">
            Nouveau message
          </label>
          <textarea
            id="new-post-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Partagez quelque chose avec les participants..."
            rows={3}
            maxLength={MAX_CONTENT_LENGTH}
            aria-label="Nouveau message"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
          />

          {/* Image previews */}
          <ImagePicker
            images={images}
            canAddMore={canAddMore}
            isUploading={isBusy}
            onAddImages={handleAddImages}
            onRemoveImage={removeImage}
          />

          {/* Toolbar */}
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleFileSelect}
                disabled={!canAddMore || isBusy}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Ajouter des images"
              >
                <ImageIcon className="h-4 w-4" aria-hidden="true" />
                Photo
              </button>
            </div>

            <div className="flex items-center gap-3">
              {showCharCount && (
                <span
                  className={`text-xs ${isOverLimit ? "text-destructive font-medium" : "text-muted-foreground"}`}
                >
                  {charCount}/{MAX_CONTENT_LENGTH}
                </span>
              )}
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                aria-label={isBusy ? "Publication en cours..." : "Publier le message"}
                className="bg-primary text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-2 transition-colors"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                {isBusy ? "..." : "Publier"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={handleFileChange}
        aria-label="Sélectionner des images pour la publication"
      />
    </div>
  );
}
