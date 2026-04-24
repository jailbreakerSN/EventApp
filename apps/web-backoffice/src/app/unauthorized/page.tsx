"use client";

import { useAuth } from "@/hooks/use-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { ShieldX, LogOut, ArrowLeft } from "lucide-react";
import { BACKOFFICE_ROLES, resolveLandingRoute } from "@/lib/access";
import type { UserRole } from "@teranga/shared-types";

/**
 * /unauthorized — dead-end shown to authenticated users whose roles
 * don't grant backoffice access.
 *
 * Two improvements over the previous implementation:
 *
 *   1. Auto-redirect checks the FULL `BACKOFFICE_ROLES` set (admin +
 *      organizer + venue + every platform:* subrole). The previous
 *      version only matched `organizer / co_organizer / super_admin`,
 *      so a venue_manager or platform:finance admin who ever landed
 *      here (stale URL, post-impersonation redirect) was stuck on a
 *      misleading dead-end instead of bouncing to their canonical
 *      home.
 *
 *   2. The role label shows the HIGHEST-privilege role (via the same
 *      priority table used in TopBar), not `roles[0]`. Firestore
 *      stores roles in insertion order so a venue_manager whose
 *      profile also carries `participant` used to render as
 *      "participant" — now renders as "venue_manager", matching the
 *      sidebar nav state.
 *
 * Priority table mirrors `pickPrimaryRole` in components/layouts/topbar
 * and `resolveLandingRoute` in lib/access. If we move the table to a
 * shared helper, update all three at once.
 */

const ROLE_PRIORITY: readonly UserRole[] = [
  "super_admin",
  "platform:super_admin",
  "platform:security",
  "platform:ops",
  "platform:finance",
  "platform:support",
  "organizer",
  "co_organizer",
  "venue_manager",
  "staff",
  "speaker",
  "sponsor",
  "participant",
] as const;

function pickPrimaryRole(roles: readonly UserRole[]): UserRole {
  for (const candidate of ROLE_PRIORITY) {
    if (roles.includes(candidate)) return candidate;
  }
  return "participant";
}

export default function UnauthorizedPage() {
  const tRoles = useTranslations("common.roles");
  const { user, logout, hasRole } = useAuth();
  const router = useRouter();

  // Use an effect for the redirect so the router isn't called during
  // render (Next.js warns about setState-in-render for hooks like
  // `useRouter`). Guards against the "backoffice-role user lands on
  // /unauthorized" case — for them we bounce to their canonical home
  // rather than show the dead-end.
  useEffect(() => {
    if (user && hasRole(...BACKOFFICE_ROLES)) {
      router.replace(resolveLandingRoute(user.roles));
    }
  }, [user, hasRole, router]);

  // Don't render the dead-end copy while a redirect is inflight.
  if (user && hasRole(...BACKOFFICE_ROLES)) return null;

  const primaryRole = pickPrimaryRole(user?.roles ?? []);
  // `tRoles(key)` returns the key when the message is missing, which
  // is safer than throwing for unknown future roles.
  const roleLabel = (() => {
    try {
      return tRoles(primaryRole);
    } catch {
      return primaryRole;
    }
  })();

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

          <h1 className="text-xl font-bold text-card-foreground mb-2">Accès non autorisé</h1>

          <p className="text-muted-foreground text-sm mb-6">
            Le back-office Teranga est réservé aux <strong>organisateurs</strong> et{" "}
            <strong>administrateurs</strong>. Votre compte{" "}
            {user?.email && (
              <span className="text-card-foreground font-medium">({user.email})</span>
            )}{" "}
            a le rôle <strong className="text-destructive">{roleLabel}</strong>, qui n&apos;a pas
            accès à cette interface.
          </p>

          <p className="text-muted-foreground text-xs mb-6">
            Si vous êtes organisateur, contactez votre administrateur pour mettre à jour vos droits
            d&apos;accès.
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
