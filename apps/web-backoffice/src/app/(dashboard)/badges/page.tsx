import type { Metadata } from "next";

export const metadata: Metadata = { title: "Badges & QR" };

export default function BadgesPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Badges & QR</h1>
      {/* TODO: Badge template editor, bulk generation, download, QR preview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Modèles de badge</h2>
          <p className="text-sm text-gray-400">Aucun modèle créé.</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Génération en masse</h2>
          <p className="text-sm text-gray-400">Sélectionnez un événement et un modèle pour générer les badges.</p>
        </div>
      </div>
    </div>
  );
}
