"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { ShieldX, LogOut, ArrowLeft } from "lucide-react";

export default function UnauthorizedPage() {
  const { user, logout, hasRole } = useAuth();
  const router = useRouter();

  // If user has a backoffice role, redirect them to dashboard
  if (user && hasRole("organizer", "co_organizer", "super_admin")) {
    router.replace("/dashboard");
    return null;
  }

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1A1A2E] to-[#16213E] px-4">
      <div className="w-full max-w-md text-center">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
              <ShieldX size={32} className="text-red-500" />
            </div>
          </div>

          <h1 className="text-xl font-bold text-gray-800 mb-2">
            Accès non autorisé
          </h1>

          <p className="text-gray-600 text-sm mb-6">
            Le back-office Teranga est réservé aux <strong>organisateurs</strong> et{" "}
            <strong>administrateurs</strong>. Votre compte{" "}
            {user?.email && (
              <span className="text-gray-800 font-medium">({user.email})</span>
            )}{" "}
            a le rôle <strong className="text-red-600">{user?.roles?.[0] ?? "participant"}</strong>,
            qui n&apos;a pas accès à cette interface.
          </p>

          <p className="text-gray-500 text-xs mb-6">
            Si vous êtes organisateur, contactez votre administrateur pour mettre
            à jour vos droits d&apos;accès.
          </p>

          <div className="flex flex-col gap-3">
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 bg-[#1A1A2E] text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-[#16213E] transition-colors"
            >
              <LogOut size={16} />
              Se déconnecter
            </button>

            <button
              onClick={() => router.push("/login")}
              className="w-full flex items-center justify-center gap-2 text-gray-600 text-sm hover:text-gray-800 transition-colors"
            >
              <ArrowLeft size={16} />
              Retour à la connexion
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
