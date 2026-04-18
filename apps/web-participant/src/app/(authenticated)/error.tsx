"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button, EmptyStateEditorial } from "@teranga/shared-ui";

export default function AuthenticatedError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AuthenticatedError]", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center p-12">
      <div className="w-full max-w-md">
        <EmptyStateEditorial
          icon={AlertTriangle}
          kicker="— ERREUR"
          title="Erreur inattendue"
          description={error.message || "Une erreur est survenue. Veuillez réessayer."}
          action={
            <Button onClick={reset}>
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
              Réessayer
            </Button>
          }
        />
      </div>
    </div>
  );
}
