"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge, QueryError, Spinner } from "@teranga/shared-ui";
import { History } from "lucide-react";
import { useAdminPlan, useAdminOrganizations } from "@/hooks/use-admin";
import { PlanForm } from "@/components/plans/PlanForm";
import { EntityDetailLayout, type EntityTab } from "@/components/admin/entity-detail-layout";

/**
 * T4.3 — /admin/plans/[planId] refactored onto EntityDetailLayout.
 *
 * Previously this page rendered a bespoke breadcrumb + PlanForm with
 * no tabs, no deep-link support, and no surface for the "which orgs
 * are on this plan + overrides" question operators actually ask. The
 * refactor brings the page in line with the rest of the admin detail
 * surfaces (users, orgs, events, venues) — same scaffold, same tab
 * URL-state, same hover-focus feel.
 *
 * Tabs:
 *   - Overview → the existing PlanForm (mode="edit") with the
 *     grandfathering warning preserved.
 *   - Overrides → list of orgs currently assigned to this plan,
 *     flagged with whether they carry per-org overrides.
 */
export default function AdminEditPlanPage() {
  const params = useParams<{ planId: string }>();
  const planId = params?.planId;
  const { data, isLoading, isError, error, refetch } = useAdminPlan(planId);
  const plan = data?.data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
        <Spinner />
      </div>
    );
  }

  if (isError || !plan) {
    return (
      <div className="container mx-auto max-w-6xl p-6">
        <QueryError
          title="Impossible de charger le plan"
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const tabs: EntityTab[] = [
    {
      id: "overview",
      label: "Aperçu",
      render: () => (
        <div className="space-y-6">
          <div
            role="note"
            className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm"
          >
            <History className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">Version actuelle : v{plan.version ?? 1}</p>
              <p className="text-muted-foreground">
                Modifier le prix, les limites ou les fonctionnalités créera une
                <strong className="text-foreground"> nouvelle version</strong>. Les organisations
                déjà abonnées restent sur leur version actuelle (droits préservés). Seuls les
                nouveaux abonnements utiliseront la nouvelle version.
              </p>
              <p className="text-muted-foreground">
                Les ajustements d&apos;ordre d&apos;affichage ou de visibilité n&apos;affectent pas
                la version.
              </p>
            </div>
          </div>
          <PlanForm mode="edit" plan={plan} />
        </div>
      ),
    },
    {
      id: "overrides",
      label: "Organisations assignées",
      render: () => <OverridesTab planKey={plan.key} />,
    },
  ];

  return (
    <EntityDetailLayout
      breadcrumbs={[
        { label: "Administration", href: "/admin" },
        { label: "Plans", href: "/admin/plans" },
        { label: plan.name.fr ?? plan.key },
      ]}
      title={plan.name.fr ?? plan.key}
      subtitle={`Clé: ${plan.key} · v${plan.version ?? 1}`}
      pills={
        <>
          <Badge variant={plan.isArchived ? "neutral" : "success"}>
            {plan.isArchived ? "Archivé" : "Actif"}
          </Badge>
          {plan.isPublic === false && <Badge variant="neutral">Privé</Badge>}
        </>
      }
      tabs={tabs}
      defaultTabId="overview"
    />
  );
}

// ─── Overrides tab ─────────────────────────────────────────────────────────

function OverridesTab({ planKey }: { planKey: string }) {
  // Reuse the existing admin org-list endpoint: filter by `plan` which
  // maps to `effectivePlanKey` server-side.
  const { data, isLoading, isError, error, refetch } = useAdminOrganizations({
    plan: planKey,
    page: 1,
    limit: 50,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
        <Spinner />
      </div>
    );
  }

  if (isError) {
    return (
      <QueryError
        title="Impossible de charger les organisations"
        message={error instanceof Error ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  const orgs = data?.data ?? [];

  if (orgs.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        Aucune organisation n&apos;est actuellement assignée à ce plan.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {orgs.length} organisation{orgs.length > 1 ? "s" : ""} sur ce plan. Les overrides
        apparaissent avec le badge « Personnalisé ».
      </p>
      <div className="divide-y divide-border rounded-xl border border-border">
        {orgs.map((org) => {
          const hasOverrides = !!(org as unknown as { effectivePlanOverrides?: unknown })
            .effectivePlanOverrides;
          return (
            <Link
              key={org.id}
              href={`/admin/organizations/${encodeURIComponent(org.id)}`}
              className="flex items-center justify-between gap-3 p-3 hover:bg-muted/50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{org.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {org.id} · créée le {new Date(org.createdAt).toLocaleDateString("fr-SN")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {hasOverrides && <Badge variant="premium">Personnalisé</Badge>}
                <Badge variant={org.isActive ? "success" : "neutral"}>
                  {org.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
