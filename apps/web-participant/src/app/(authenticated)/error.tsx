"use client";

import { useEffect } from "react";
import { QueryError } from "@teranga/shared-ui";

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
      <QueryError
        title="Erreur inattendue"
        message={error.message || "Une erreur est survenue. Veuillez réessayer."}
        onRetry={reset}
      />
    </div>
  );
}
