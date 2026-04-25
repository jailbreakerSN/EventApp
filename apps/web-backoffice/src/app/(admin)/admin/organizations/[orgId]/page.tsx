"use client";

/**
 * Phase 3 — Organization admin detail page.
 *
 * Renders via the shared <EntityDetailLayout> scaffold with 5 tabs:
 *   - Aperçu       : org metadata + plan + contact + effective limits
 *   - Membres      : list of user IDs with role (list from org.memberIds)
 *   - Événements   : events this org owns, paginated
 *   - Abonnement   : current subscription snapshot
 *   - Audit        : audit log entries where resourceType=organization
 *
 * Goal: no more jumping between 5 admin pages to investigate a single
 * organization. Everything relevant lives here, URL-linkable per tab.
 *
 * Actions in the header: verify (if not verified), suspend/reactivate,
 * assign plan (delegated to the existing AssignPlanDialog once we wire
 * it in a later commit of this phase).
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Badge, Card, CardContent, Skeleton, InlineErrorBanner } from "@teranga/shared-ui";
import {
  ShieldCheck,
  Ban,
  Power,
  CheckCircle2,
  Building2,
  Calendar,
  Mail,
  Phone,
  Globe,
  MapPin,
} from "lucide-react";
import type { Organization } from "@teranga/shared-types";
import { organizationsApi, adminApi } from "@/lib/api-client";
import { EntityDetailLayout } from "@/components/admin/entity-detail-layout";
import { ApiKeysTab } from "@/components/admin/api-keys-tab";
import { useErrorHandler } from "@/hooks/use-error-handler";

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AdminOrganizationDetailPage() {
  const params = useParams<{ orgId: string }>();
  const router = useRouter();
  const { resolve } = useErrorHandler();

  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrg = useCallback(async () => {
    try {
      setLoading(true);
      const res = await organizationsApi.getById(params.orgId);
      setOrg(res.data);
      setError(null);
    } catch (err) {
      setError(resolve(err).description);
    } finally {
      setLoading(false);
    }
  }, [params.orgId, resolve]);

  useEffect(() => {
    void fetchOrg();
  }, [fetchOrg]);

  const handleVerify = useCallback(async () => {
    if (!org) return;
    try {
      await adminApi.verifyOrganization(org.id);
      await fetchOrg();
    } catch (err) {
      setError(resolve(err).description);
    }
  }, [org, fetchOrg, resolve]);

  const handleToggleStatus = useCallback(async () => {
    if (!org) return;
    try {
      await adminApi.updateOrgStatus(org.id, !org.isActive);
      await fetchOrg();
    } catch (err) {
      setError(resolve(err).description);
    }
  }, [org, fetchOrg, resolve]);

  // Loading skeleton
  if (loading && !org) {
    return (
      <div className="container mx-auto max-w-6xl space-y-6 p-6">
        <Skeleton variant="text" className="h-4 w-64" />
        <Skeleton variant="text" className="h-8 w-80" />
        <Skeleton variant="text" className="h-4 w-full" />
        <Skeleton variant="text" className="h-96 w-full" />
      </div>
    );
  }

  if (error && !org) {
    return (
      <div className="container mx-auto max-w-4xl p-6">
        <InlineErrorBanner
          severity="destructive"
          kicker="— Erreur"
          title="Impossible de charger l'organisation"
          description={error}
        />
        <button
          type="button"
          onClick={() => router.push("/admin/organizations")}
          className="mt-4 text-sm text-teranga-gold hover:underline"
        >
          ← Retour à la liste
        </button>
      </div>
    );
  }

  if (!org) return null;

  return (
    <EntityDetailLayout
      breadcrumbs={[
        { label: "Administration", href: "/admin" },
        { label: "Organisations", href: "/admin/organizations" },
        { label: org.name },
      ]}
      title={org.name}
      subtitle={
        <span className="inline-flex items-center gap-2">
          <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
          <code className="font-mono text-[11px]">{org.slug}</code>
          {org.city && (
            <>
              <span aria-hidden="true">·</span>
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {org.city}, {org.country}
            </>
          )}
        </span>
      }
      pills={
        <>
          <Badge variant={planVariant(org.plan)}>{org.plan}</Badge>
          {org.isVerified ? (
            <Badge variant="secondary" className="gap-1">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              Vérifiée
            </Badge>
          ) : (
            <Badge variant="outline">Non vérifiée</Badge>
          )}
          {!org.isActive && (
            <Badge variant="destructive" className="gap-1">
              <Ban className="h-3 w-3" aria-hidden="true" />
              Suspendue
            </Badge>
          )}
        </>
      }
      quickActions={[
        ...(org.isVerified
          ? []
          : [
              {
                id: "verify",
                label: "Vérifier",
                icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
                onClick: () => void handleVerify(),
              },
            ]),
        {
          id: "toggle-status",
          label: org.isActive ? "Suspendre" : "Réactiver",
          icon: org.isActive ? (
            <Ban className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Power className="h-4 w-4" aria-hidden="true" />
          ),
          variant: org.isActive ? "destructive" : "default",
          onClick: () => void handleToggleStatus(),
        },
      ]}
      tabs={[
        {
          id: "overview",
          label: "Aperçu",
          render: () => <OverviewTab org={org} />,
        },
        {
          id: "members",
          label: "Membres",
          count: org.memberIds?.length ?? 0,
          render: () => <MembersTab org={org} />,
        },
        {
          id: "events",
          label: "Événements",
          render: () => <EventsTab orgId={org.id} />,
        },
        {
          id: "subscription",
          label: "Abonnement",
          render: () => <SubscriptionTab org={org} />,
        },
        {
          id: "api-keys",
          label: "Clés API",
          render: () => <ApiKeysTab orgId={org.id} orgName={org.name} />,
        },
        {
          id: "audit",
          label: "Audit",
          render: () => <AuditTab orgId={org.id} />,
        },
      ]}
    />
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function planVariant(plan: string): "secondary" | "outline" | "success" | "neutral" {
  switch (plan) {
    case "enterprise":
      return "success";
    case "pro":
      return "secondary";
    case "starter":
      return "outline";
    default:
      return "neutral";
  }
}

// ─── Tab components ──────────────────────────────────────────────────────────
// Kept minimal here — Phase 3 ships the scaffold. Later commits in this
// phase populate Members, Events, Subscription, and Audit with real
// data joins.

function OverviewTab({ org }: { org: Organization }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardContent className="space-y-3 p-4 text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Contact
          </div>
          {org.email && (
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <a href={`mailto:${org.email}`} className="text-teranga-gold hover:underline">
                {org.email}
              </a>
            </div>
          )}
          {org.phone && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span>{org.phone}</span>
            </div>
          )}
          {org.website && (
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <a
                href={org.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-teranga-gold hover:underline"
              >
                {org.website}
              </a>
            </div>
          )}
          {org.description && <div className="pt-2 text-muted-foreground">{org.description}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4 text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Limites effectives (plan + overrides)
          </div>
          {org.effectiveLimits ? (
            <>
              <LimitRow label="Événements" value={fmtLimit(org.effectiveLimits.maxEvents)} />
              <LimitRow
                label="Participants / événement"
                value={fmtLimit(org.effectiveLimits.maxParticipantsPerEvent)}
              />
              <LimitRow label="Membres" value={fmtLimit(org.effectiveLimits.maxMembers)} />
            </>
          ) : (
            <div className="text-muted-foreground">Pas encore calculées (backfill pending).</div>
          )}
          <div className="pt-2 text-[11px] text-muted-foreground">
            <Calendar className="mr-1 inline h-3 w-3" aria-hidden="true" />
            Créée le {new Date(org.createdAt).toLocaleDateString("fr-FR")}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LimitRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 pb-1 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs font-medium text-foreground">{value}</span>
    </div>
  );
}

function fmtLimit(value: number): string {
  return Number.isFinite(value) ? String(value) : "∞";
}

function MembersTab({ org }: { org: Organization }) {
  if (!org.memberIds || org.memberIds.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 className="h-8 w-8" aria-hidden="true" />}
        title="Aucun membre"
        description="Cette organisation n'a pas encore de membres."
      />
    );
  }
  return (
    <Card>
      <CardContent className="divide-y divide-border p-0">
        {org.memberIds.map((uid) => (
          <div key={uid} className="flex items-center justify-between p-3">
            <code className="font-mono text-xs text-foreground">{uid}</code>
            <Link
              href={`/admin/users/${uid}`}
              className="text-xs text-teranga-gold hover:underline"
            >
              Ouvrir la fiche →
            </Link>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function EventsTab({ orgId }: { orgId: string }) {
  // Deep-link to the /admin/events filtered view. Inline listing in a
  // follow-up commit — this phase focuses on the scaffold.
  return (
    <EmptyState
      icon={<Calendar className="h-8 w-8" aria-hidden="true" />}
      title="Voir les événements de cette org"
      description="La liste filtrée des événements est disponible dans la page Événements."
      action={
        <Link
          href={`/admin/events?organizationId=${encodeURIComponent(orgId)}`}
          className="text-sm font-medium text-teranga-gold hover:underline"
        >
          Ouvrir la liste filtrée →
        </Link>
      }
    />
  );
}

function SubscriptionTab({ org }: { org: Organization }) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4 text-sm">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Plan actuel
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={planVariant(org.plan)}>{org.plan}</Badge>
          {org.effectivePlanKey && org.effectivePlanKey !== org.plan && (
            <Badge variant="outline" className="text-[10px]">
              overridden → {org.effectivePlanKey}
            </Badge>
          )}
        </div>
        <div className="pt-3 text-xs text-muted-foreground">
          La page dédiée aux abonnements arrive dans une phase ultérieure. Pour modifier le plan ou
          les overrides, utilisez la page Organisations.
        </div>
      </CardContent>
    </Card>
  );
}

function AuditTab(_props: { orgId: string }) {
  return (
    <EmptyState
      icon={<Calendar className="h-8 w-8" aria-hidden="true" />}
      title="Audit filtré sur cette organisation"
      description="La timeline d'audit filtrée est disponible dans la page Audit."
      action={
        <Link
          href={`/admin/audit?resourceType=organization`}
          className="text-sm font-medium text-teranga-gold hover:underline"
        >
          Ouvrir l'audit →
        </Link>
      }
    />
  );
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
        <div className="text-muted-foreground">{icon}</div>
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="max-w-sm text-xs text-muted-foreground">{description}</div>
        {action && <div className="mt-2">{action}</div>}
      </CardContent>
    </Card>
  );
}
