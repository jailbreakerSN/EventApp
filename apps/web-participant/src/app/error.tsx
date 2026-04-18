"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button, EmptyStateEditorial } from "@teranga/shared-ui";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <EmptyStateEditorial
          icon={AlertTriangle}
          kicker="— ERREUR"
          title="Une erreur est survenue"
          description={error.message || "Quelque chose s’est mal passé. Veuillez réessayer."}
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={reset}>
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                Réessayer
              </Button>
              <a href="/events">
                <Button variant="outline">Accueil</Button>
              </a>
            </div>
          }
        />
      </div>
    </div>
  );
}
