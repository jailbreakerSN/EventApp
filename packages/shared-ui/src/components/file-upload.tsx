"use client";

import * as React from "react";
import { Upload, X } from "lucide-react";
import { cn } from "../lib/utils";

export interface FileUploadProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onDrop"> {
  accept?: string;
  maxSizeMB?: number;
  onFileSelect: (file: File) => void;
  label?: string;
  description?: string;
}

function FileUpload({
  accept,
  maxSizeMB,
  onFileSelect,
  label = "Glissez un fichier ici",
  description,
  className,
  ...props
}: FileUploadProps) {
  const [isDragging, setIsDragging] = React.useState(false);
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const validateAndSelect = (file: File) => {
    setError(null);

    if (maxSizeMB && file.size > maxSizeMB * 1024 * 1024) {
      setError(`Le fichier dépasse ${maxSizeMB} Mo`);
      return;
    }

    if (accept) {
      const acceptedTypes = accept.split(",").map((t) => t.trim());
      const matches = acceptedTypes.some((type) => {
        if (type.startsWith(".")) {
          return file.name.toLowerCase().endsWith(type.toLowerCase());
        }
        if (type.endsWith("/*")) {
          return file.type.startsWith(type.replace("/*", "/"));
        }
        return file.type === type;
      });
      if (!matches) {
        setError("Type de fichier non accepté");
        return;
      }
    }

    setSelectedFile(file);
    onFileSelect(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) validateAndSelect(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) validateAndSelect(file);
  };

  const handleClear = () => {
    setSelectedFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className={cn("w-full", className)} {...props}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors",
          "text-muted-foreground hover:border-primary/50 hover:bg-accent/50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isDragging && "border-primary bg-accent/50",
          error && "border-destructive",
        )}
      >
        <Upload className="h-8 w-8" />
        <span className="text-sm font-medium">{label}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
        {maxSizeMB && <span className="text-xs text-muted-foreground">Max {maxSizeMB} Mo</span>}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        className="sr-only"
        tabIndex={-1}
      />

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {selectedFile && !error && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
          <span className="truncate flex-1 text-foreground">{selectedFile.name}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleClear();
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Supprimer le fichier"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
FileUpload.displayName = "FileUpload";

export { FileUpload };
