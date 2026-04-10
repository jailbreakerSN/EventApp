"use client";

import { RefreshCw } from "lucide-react";

interface NewPostsBannerProps {
  count: number;
  onRefresh: () => void;
}

export function NewPostsBanner({ count, onRefresh }: NewPostsBannerProps) {
  if (count <= 0) return null;

  return (
    <button
      onClick={() => {
        onRefresh();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }}
      className="sticky top-16 z-10 mb-4 w-full rounded-lg bg-primary/10 border border-primary/20 px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/15 transition-colors flex items-center justify-center gap-2"
      aria-live="polite"
    >
      <RefreshCw className="h-4 w-4" aria-hidden="true" />
      {count === 1 ? "1 nouvelle publication" : `${count} nouvelles publications`} — Cliquez pour
      actualiser
    </button>
  );
}
