import type { Metadata } from "next";

export const metadata: Metadata = { title: "Paramètres" };

export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Paramètres</h1>
      {/* TODO: Profile settings, password change, language preference, notification preferences, API keys */}
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-800 mb-2">Profil personnel</h2>
          <p className="text-sm text-gray-400">Nom, email, photo, mot de passe</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-800 mb-2">Préférences</h2>
          <p className="text-sm text-gray-400">Langue, fuseau horaire, thème</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-800 mb-2">Intégrations & Webhooks</h2>
          <p className="text-sm text-gray-400">Clés API, webhooks, Wave/Orange Money</p>
        </div>
      </div>
    </div>
  );
}
