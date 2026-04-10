"use client";

import { useState, useCallback } from "react";
import { feedApi } from "@/lib/api-client";

const MAX_IMAGES = 5;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface FeedImage {
  file: File;
  previewUrl: string;
  uploadedUrl: string | null;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

export function useFeedUpload(eventId: string) {
  const [images, setImages] = useState<FeedImage[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const addImages = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      const errors: string[] = [];

      const remaining = MAX_IMAGES - images.length;
      if (remaining <= 0) {
        errors.push(`Maximum ${MAX_IMAGES} images`);
        return errors;
      }

      const toAdd: FeedImage[] = [];
      for (const file of fileArray.slice(0, remaining)) {
        if (!ALLOWED_TYPES.has(file.type)) {
          errors.push(`${file.name}: format non supporté (JPEG, PNG ou WebP)`);
          continue;
        }
        if (file.size > MAX_FILE_SIZE) {
          errors.push(`${file.name}: taille maximale 5 Mo`);
          continue;
        }
        toAdd.push({
          file,
          previewUrl: URL.createObjectURL(file),
          uploadedUrl: null,
          status: "pending",
        });
      }

      if (toAdd.length > 0) {
        setImages((prev) => [...prev, ...toAdd]);
      }

      return errors;
    },
    [images.length],
  );

  const removeImage = useCallback((index: number) => {
    setImages((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const clearAll = useCallback(() => {
    setImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      return [];
    });
  }, []);

  const uploadAll = useCallback(async (): Promise<string[]> => {
    if (images.length === 0) return [];

    setIsUploading(true);
    const uploadedUrls: string[] = [];

    try {
      // Upload sequentially to be gentle on African networks
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (img.status === "done" && img.uploadedUrl) {
          uploadedUrls.push(img.uploadedUrl);
          continue;
        }

        setImages((prev) =>
          prev.map((item, idx) => (idx === i ? { ...item, status: "uploading" } : item)),
        );

        try {
          // Get signed URL
          const { data } = await feedApi.getUploadUrl(eventId, {
            fileName: img.file.name,
            contentType: img.file.type,
          });

          const { uploadUrl, publicUrl } = data;

          // Upload file to signed URL
          const uploadResponse = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": img.file.type },
            body: img.file,
          });

          if (!uploadResponse.ok) {
            throw new Error(`Upload échoué (${uploadResponse.status})`);
          }

          uploadedUrls.push(publicUrl);
          setImages((prev) =>
            prev.map((item, idx) =>
              idx === i ? { ...item, status: "done", uploadedUrl: publicUrl } : item,
            ),
          );
        } catch {
          setImages((prev) =>
            prev.map((item, idx) =>
              idx === i ? { ...item, status: "error", error: "Échec de l'upload" } : item,
            ),
          );
          throw new Error(`Échec de l'upload de ${img.file.name}`);
        }
      }

      return uploadedUrls;
    } finally {
      setIsUploading(false);
    }
  }, [images, eventId]);

  return {
    images,
    addImages,
    removeImage,
    clearAll,
    uploadAll,
    isUploading,
    canAddMore: images.length < MAX_IMAGES,
  };
}
