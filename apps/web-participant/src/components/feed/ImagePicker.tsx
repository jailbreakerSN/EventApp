"use client";

import { useRef } from "react";
import Image from "next/image";
import { ImagePlus, X, Loader2, AlertCircle } from "lucide-react";
import type { FeedImage } from "@/hooks/use-feed-upload";

interface ImagePickerProps {
  images: FeedImage[];
  canAddMore: boolean;
  isUploading: boolean;
  onAddImages: (files: FileList) => string[];
  onRemoveImage: (index: number) => void;
}

export function ImagePicker({
  images,
  canAddMore,
  isUploading,
  onAddImages,
  onRemoveImage,
}: ImagePickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAddImages(e.target.files);
      // Reset so the same file can be re-selected
      e.target.value = "";
    }
  };

  if (images.length === 0) return null;

  return (
    <div className="mt-2">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {images.map((img, index) => (
          <div
            key={img.previewUrl}
            className="relative flex-shrink-0 h-20 w-20 rounded-lg overflow-hidden border border-border"
          >
            <Image
              src={img.previewUrl}
              alt={`Image ${index + 1}`}
              fill
              className="object-cover"
              unoptimized
            />

            {/* Status overlay */}
            {img.status === "uploading" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <Loader2 className="h-5 w-5 text-white animate-spin" />
              </div>
            )}
            {img.status === "error" && (
              <div className="absolute inset-0 flex items-center justify-center bg-red-500/40">
                <AlertCircle className="h-5 w-5 text-white" />
              </div>
            )}
            {img.status === "done" && (
              <div className="absolute bottom-0.5 right-0.5 h-4 w-4 rounded-full bg-green-500 flex items-center justify-center">
                <span className="text-white text-[10px]">✓</span>
              </div>
            )}

            {/* Remove button */}
            {!isUploading && (
              <button
                onClick={() => onRemoveImage(index)}
                className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80 transition-colors"
                aria-label={`Supprimer l'image ${index + 1}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}

        {/* Add more button */}
        {canAddMore && !isUploading && (
          <button
            onClick={handleFileSelect}
            className="flex-shrink-0 h-20 w-20 rounded-lg border-2 border-dashed border-border flex items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors"
            aria-label="Ajouter une image"
          >
            <ImagePlus className="h-5 w-5" />
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}
