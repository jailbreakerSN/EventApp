"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { ShieldX, LogOut, ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

export default function UnauthorizedPage() {
  const _t = useTranslations("common"); void _t;
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary to-primary/80 dark:from-background dark:to-muted px-4">
      <div className="w-full max-w-md text-center">
        <div className="bg-card rounded-2xl shadow-2xl p-8">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <ShieldX size={32} className="text-red-500 dark:text-red-400" />
            </div>
          </div>

          <h1 className="text-xl font-bold text-card-foreground mb-2">
            Accès non autorisé
          </h1>

          <p className="text-muted-foreground text-sm mb-6">
            Le back-office Teranga est réservé aux <strong>organisateurs</strong> et{" "}
            <strong>administrateurs</strong>. Votre compte{" "}
            {user?.email && (
              <span className="text-card-foreground font-medium">({user.email})</span>
            )}{" "}
            a le rôle <strong className="text-destructive">{user?.roles?.[0] ?? "participant"}</strong>,
            qui n&apos;a pas accès à cette interface.
          </p>

          <p className="text-muted-foreground text-xs mb-6">
            Si vous êtes organisateur, contactez votre administrateur pour mettre
            à jour vos droits d&apos;accès.
          </p>

          <div className="flex flex-col gap-3">
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-lg py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              <LogOut size={16} />
              Se déconnecter
            </button>

            <button
              onClick={() => router.push("/login")}
              className="w-full flex items-center justify-center gap-2 text-muted-foreground text-sm hover:text-foreground transition-colors"
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
