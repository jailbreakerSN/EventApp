"use client";

import { AlertCircle, RotateCcw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-xl border border-red-100 p-8 text-center">
        <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Une erreur est survenue
        </h2>
        <p className="text-sm text-gray-500 mb-6">
          {error.message || "Quelque chose s'est mal passé. Veuillez réessayer."}
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 bg-[#1A1A2E] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#16213E]"
          >
            <RotateCcw className="h-4 w-4" />
            Réessayer
          </button>
          <a
            href="/events"
            className="inline-flex items-center gap-2 border border-gray-200 text-gray-700 rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Tableau de bord
          </a>
        </div>
      </div>
    </div>
  );
}
