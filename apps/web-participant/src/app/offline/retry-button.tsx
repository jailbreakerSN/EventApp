"use client";

import { RotateCcw } from "lucide-react";

export function RetryButton() {
  return (
    <button
      onClick={() => window.location.reload()}
      className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-6 py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors"
    >
      <RotateCcw className="h-4 w-4" />
      {"R\u00e9essayer"}
    </button>
  );
}
