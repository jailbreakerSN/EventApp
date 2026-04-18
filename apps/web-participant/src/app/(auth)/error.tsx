"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button, EmptyStateEditorial } from "@teranga/shared-ui";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AuthError]", error);
  }, [error]);

  return (
    <div className="w-full">
      <EmptyStateEditorial
        icon={AlertTriangle}
        kicker="— ERREUR"
        title="Erreur d’authentification"
        description={error.message || "Une erreur est survenue. Veuillez réessayer."}
        action={
          <Button onClick={reset}>
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            Réessayer
          </Button>
        }
      />
    </div>
  );
}
