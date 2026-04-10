"use client";

import { useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

interface PostMenuProps {
  onEdit: () => void;
  onDelete: () => void;
}

export function PostMenu({ onEdit, onDelete }: PostMenuProps) {
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
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
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
