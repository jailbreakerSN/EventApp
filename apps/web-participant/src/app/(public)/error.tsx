"use client";

import { useEffect } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";

export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[PublicError]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6 bg-background">
      <div className="max-w-md w-full bg-card rounded-xl border border-destructive/20 p-8 text-center">
        <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-foreground mb-2">Une erreur est survenue</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {error.message || "Impossible de charger cette page. Veuillez réessayer."}
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary/90"
        >
          <RotateCcw className="h-4 w-4" />
          Réessayer
        </button>
      </div>
    </div>
  );
}
