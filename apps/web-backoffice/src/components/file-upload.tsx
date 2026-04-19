"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, X, Loader2, CheckCircle, AlertCircle } from "lucide-react";

interface FileUploadProps {
  /**
   * Function to get a signed upload URL from the API.
   * Returns the signed URL, the download URL, and any headers the
   * server signed into the URL that the client MUST replay on the PUT
   * request. The signed `x-goog-content-length-range` header is the
   * canonical way to enforce size on the GCS edge — we pass it back
   * here so each caller doesn't have to rebuild it, and so the server
   * remains the single source of truth for size limits.
   */
  getUploadUrl: (file: File) => Promise<{
    uploadUrl: string;
    downloadUrl: string;
    /** Headers to merge with the PUT request. Keys are lowercase. */
    requiredHeaders?: Record<string, string>;
  }>;
  /**
   * Called after successful upload with the download URL.
   */
  onUploaded: (downloadUrl: string) => void;
  /**
   * Accepted MIME types (e.g., "image/*", "application/pdf")
   */
  accept?: string;
  /**
   * Max file size in bytes (default: 10MB)
   */
  maxSize?: number;
  /**
   * Label text
   */
  label?: string;
  /**
   * Help text shown below the drop zone
   */
  helpText?: string;
  /**
   * Current image URL for preview
   */
  currentUrl?: string | null;
}

type UploadState = "idle" | "uploading" | "success" | "error";

export function FileUpload({
  getUploadUrl,
  onUploaded,
  accept = "image/*",
  maxSize = 10 * 1024 * 1024,
  label = "Téléverser un fichier",
  helpText = "Glissez-déposez ou cliquez pour sélectionner",
  currentUrl,
}: FileUploadProps) {
  const [state, setState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl ?? null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      // Validate size
      if (file.size > maxSize) {
        const maxMB = Math.round(maxSize / 1024 / 1024);
        setError(`Fichier trop volumineux (max ${maxMB} Mo)`);
        setState("error");
        return;
      }

      // Validate type
      if (accept && accept !== "*") {
        const acceptedTypes = accept.split(",").map((t) => t.trim());
        const matches = acceptedTypes.some((t) => {
          if (t.endsWith("/*")) {
            return file.type.startsWith(t.replace("/*", "/"));
          }
          return file.type === t;
        });
        if (!matches) {
          setError("Type de fichier non accepté");
          setState("error");
          return;
        }
      }

      // Preview for images
      if (file.type.startsWith("image/")) {
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
      }

      try {
        setState("uploading");
        setProgress(20);
        setError(null);

        // Get signed URL
        const { uploadUrl, downloadUrl, requiredHeaders } = await getUploadUrl(file);
        setProgress(50);

        // Upload to signed URL. Merge `Content-Type` with any headers
        // the server signed into the URL (e.g. `x-goog-content-length-range`
        // which enforces the MAX upload size at the GCS edge). Omitting
        // them produces a 403 `SignatureDoesNotMatch` from GCS.
        const uploadResponse = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type, ...(requiredHeaders ?? {}) },
          body: file,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload échoué (${uploadResponse.status})`);
        }

        setProgress(100);
        setState("success");
        onUploaded(downloadUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur lors du téléversement");
        setState("error");
      }
    },
    [accept, maxSize, getUploadUrl, onUploaded],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleRemove = () => {
    setPreviewUrl(null);
    setState("idle");
    setProgress(0);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      {label && <label className="text-sm font-medium">{label}</label>}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => state !== "uploading" && inputRef.current?.click()}
        className={`relative cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragOver
            ? "border-secondary bg-secondary/5"
            : state === "error"
              ? "border-red-300 bg-red-50"
              : state === "success"
                ? "border-green-300 bg-green-50"
                : "border-border hover:border-border/80 hover:bg-muted"
        }`}
        role="button"
        tabIndex={0}
        aria-label={label}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleInputChange}
          className="hidden"
          aria-hidden="true"
        />

        {previewUrl && accept?.includes("image") ? (
          <div className="relative mx-auto w-32 h-32">
            <img src={previewUrl} alt="Aperçu" className="h-full w-full rounded-lg object-cover" />
            {state !== "uploading" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove();
                }}
                className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white hover:bg-red-600"
                aria-label="Supprimer"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ) : (
          <>
            {state === "uploading" ? (
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-secondary" />
            ) : state === "success" ? (
              <CheckCircle className="mx-auto h-8 w-8 text-green-500" />
            ) : state === "error" ? (
              <AlertCircle className="mx-auto h-8 w-8 text-red-500" />
            ) : (
              <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
            )}
          </>
        )}

        {state === "uploading" && (
          <div className="mt-3">
            <div className="mx-auto h-1.5 w-48 rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-secondary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Téléversement en cours...</p>
          </div>
        )}

        {state === "idle" && <p className="mt-2 text-sm text-muted-foreground">{helpText}</p>}

        {state === "success" && (
          <p className="mt-2 text-sm text-green-600">Fichier téléversé avec succès</p>
        )}

        {state === "error" && error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
