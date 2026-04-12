"use client";

import { useEffect } from "react";
import { QueryError } from "@teranga/shared-ui";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to stderr for server-side visibility; Sentry capture can be added here
    console.error("[DashboardError]", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center p-12">
      <QueryError
        title="Erreur inattendue"
        message={error.message || "Une erreur est survenue dans le tableau de bord."}
        onRetry={reset}
      />
    </div>
  );
}
