import type { Metadata } from "next";

export const metadata: Metadata = { title: "Organisation" };

export default function OrganizationPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Organisation</h1>
      {/* TODO: Org profile editor, member management, plan/billing, staff assignment */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Profil</h2>
          <p className="text-sm text-gray-400">Logo, nom, description, contact</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Membres & Staff</h2>
          <p className="text-sm text-gray-400">Gérez les rôles et accès de votre équipe</p>
        </div>
      </div>
    </div>
  );
}
