"use client";

/**
 * Phase 3 — User admin detail page.
 *
 * Companion to /admin/organizations/[orgId]. Mirrors the same
 * EntityDetailLayout contract so admins have one predictable
 * navigation metaphor across all resources.
 *
 * Tabs:
 *   - Aperçu         : profile + roles + JWT drift indicator
 *   - Organisations  : org memberships
 *   - Activité       : deep-links to audit / registrations
 *
 * Phase 4 adds the "Se connecter en tant que" quick-action.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Badge, Card, CardContent, Skeleton, InlineErrorBanner } from "@teranga/shared-ui";
import {
  ShieldAlert,
  Ban,
  Power,
  Mail,
  Phone,
  Building2,
  Calendar,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type { AdminUserRow } from "@teranga/shared-types";
import { adminApi } from "@/lib/api-client";
import { EntityDetailLayout } from "@/components/admin/entity-detail-layout";
import { useErrorHandler } from "@/hooks/use-error-handler";

export default function AdminUserDetailPage() {
  const params = useParams<{ userId: string }>();
  const router = useRouter();
  const { resolve } = useErrorHandler();

  const [user, setUser] = useState<AdminUserRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = useCallback(async () => {
    try {
      setLoading(true);
      const res = await adminApi.getUser(params.userId);
      setUser(res.data);
      setError(null);
    } catch (err) {
      setError(resolve(err).description);
    } finally {
      setLoading(false);
    }
  }, [params.userId, resolve]);

  useEffect(() => {
    void fetchUser();
  }, [fetchUser]);

  const handleToggleStatus = useCallback(async () => {
    if (!user) return;
    try {
      await adminApi.updateUserStatus(user.uid, !user.isActive);
      await fetchUser();
    } catch (err) {
      setError(resolve(err).description);
    }
  }, [user, fetchUser, resolve]);

  if (loading && !user) {
    return (
      <div className="container mx-auto max-w-6xl space-y-6 p-6">
        <Skeleton variant="text" className="h-4 w-64" />
        <Skeleton variant="text" className="h-8 w-80" />
        <Skeleton variant="text" className="h-96 w-full" />
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="container mx-auto max-w-4xl p-6">
        <InlineErrorBanner
          severity="destructive"
          kicker="— Erreur"
          title="Impossible de charger l'utilisateur"
          description={error}
        />
        <button
          type="button"
          onClick={() => router.push("/admin/users")}
          className="mt-4 text-sm text-teranga-gold hover:underline"
        >
          ← Retour à la liste
        </button>
      </div>
    );
  }

  if (!user) return null;

  const hasDrift =
    user.claimsMatch === null ||
    !user.claimsMatch.roles ||
    !user.claimsMatch.organizationId ||
    !user.claimsMatch.orgRole;

  return (
    <EntityDetailLayout
      breadcrumbs={[
        { label: "Administration", href: "/admin" },
        { label: "Utilisateurs", href: "/admin/users" },
        { label: user.displayName ?? user.email },
      ]}
      title={user.displayName ?? user.email}
      subtitle={
        <span className="inline-flex items-center gap-2">
          <Mail className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{user.email}</span>
          <code className="font-mono text-[11px] text-muted-foreground">· {user.uid}</code>
        </span>
      }
      pills={
        <>
          {user.roles.map((r) => (
            <Badge key={r} variant="secondary" className="text-[10px]">
              {r}
            </Badge>
          ))}
          {hasDrift && (
            <Badge variant="outline" className="gap-1 border-amber-400 text-amber-700">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              Drift JWT
            </Badge>
          )}
          {user.isActive ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              Actif
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <Ban className="h-3 w-3" aria-hidden="true" />
              Suspendu
            </Badge>
          )}
        </>
      }
      quickActions={[
        {
          id: "toggle-status",
          label: user.isActive ? "Suspendre" : "Réactiver",
          icon: user.isActive ? (
            <Ban className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Power className="h-4 w-4" aria-hidden="true" />
          ),
          variant: user.isActive ? "destructive" : "default",
          onClick: () => void handleToggleStatus(),
        },
        {
          id: "impersonate",
          label: "Se connecter en tant que",
          icon: <ShieldAlert className="h-4 w-4" aria-hidden="true" />,
          disabledReason: "Disponible en Phase 4 — fonction d'impersonation",
        },
      ]}
      tabs={[
        {
          id: "overview",
          label: "Aperçu",
          render: () => <OverviewTab user={user} />,
        },
        {
          id: "organizations",
          label: "Organisations",
          count: user.organizationId ? 1 : 0,
          render: () => <OrganizationsTab user={user} />,
        },
        {
          id: "activity",
          label: "Activité",
          render: () => <ActivityTab user={user} />,
        },
      ]}
    />
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

function OverviewTab({ user }: { user: AdminUserRow }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardContent className="space-y-3 p-4 text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Profil
          </div>
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span>{user.email}</span>
          </div>
          {user.phone && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span>{user.phone}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            Inscrit le {new Date(user.createdAt).toLocaleDateString("fr-FR")}
          </div>
          {user.bio && <div className="pt-2 text-muted-foreground">{user.bio}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4 text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Rôles & Claims
          </div>
          <div className="flex flex-wrap gap-1.5">
            {user.roles.map((r) => (
              <Badge key={r} variant="secondary" className="text-[10px]">
                {r}
              </Badge>
            ))}
          </div>
          {user.claimsMatch && (
            <div className="space-y-1 pt-2 text-xs">
              <DriftRow label="Rôles" ok={user.claimsMatch.roles} />
              <DriftRow label="organizationId" ok={user.claimsMatch.organizationId} />
              <DriftRow label="orgRole" ok={user.claimsMatch.orgRole} />
            </div>
          )}
          {user.claimsMatch === null && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
              Fiche Firebase Auth introuvable — à réconcilier.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DriftRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      {ok ? (
        <span className="inline-flex items-center gap-1 text-teranga-green">
          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
          sync
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-amber-600">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          drift
        </span>
      )}
    </div>
  );
}

function OrganizationsTab({ user }: { user: AdminUserRow }) {
  if (!user.organizationId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
          <Building2 className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <div className="text-sm font-semibold text-foreground">Aucune organisation</div>
          <div className="max-w-sm text-xs text-muted-foreground">
            Cet utilisateur n'est rattaché à aucune organisation.
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <code className="font-mono text-xs">{user.organizationId}</code>
            {user.orgRole && (
              <Badge variant="outline" className="text-[10px]">
                {user.orgRole}
              </Badge>
            )}
          </div>
          <Link
            href={`/admin/organizations/${user.organizationId}`}
            className="text-xs text-teranga-gold hover:underline"
          >
            Ouvrir la fiche →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityTab({ user }: { user: AdminUserRow }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
        <Calendar className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <div className="text-sm font-semibold text-foreground">Historique d'activité</div>
        <div className="max-w-sm text-xs text-muted-foreground">
          Consultez l'audit filtré sur cet utilisateur pour voir toutes ses actions.
        </div>
        <Link
          href={`/admin/audit?actorId=${encodeURIComponent(user.uid)}`}
          className="mt-2 text-sm font-medium text-teranga-gold hover:underline"
        >
          Ouvrir l'audit →
        </Link>
      </CardContent>
    </Card>
  );
}
