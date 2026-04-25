"use client";

/**
 * A.2 closure — API keys landing page.
 *
 * Issuance / rotation / revocation has moved to a per-org tab on
 * `/admin/organizations/[orgId]?tab=api-keys`. That's the right
 * surface because every key is org-scoped and the audit trail
 * lives next to the rest of the org's lifecycle (audit, billing,
 * subscription, members).
 *
 * This page now serves as a navigation aid: it surfaces every org
 * that has `apiAccess` enabled (enterprise tier today) so an admin
 * can jump directly to the relevant org tab without having to
 * remember which plan unlocks the feature.
 */

import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Card,
  CardContent,
  SectionHeader,
  Spinner,
  InlineErrorBanner,
  Badge,
} from "@teranga/shared-ui";
import { KeyRound, ArrowRight, Building2 } from "lucide-react";
import { useAdminOrganizations } from "@/hooks/use-admin";

export default function AdminApiKeysPage() {
  // Enterprise-tier orgs are the canonical apiAccess holders today.
  // Plan filter is server-side; the per-org `effectivePlanOverrides`
  // can grant `apiAccess` to a non-enterprise org as well, but a 50-
  // org list filter is small enough for the few outliers to be
  // findable via the org search separately.
  const { data, isLoading, isError, error, refetch } = useAdminOrganizations({
    plan: "enterprise",
    page: 1,
    limit: 100,
  });

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Administration</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Clés API</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <SectionHeader
        kicker="— Platform"
        title="Clés API (Enterprise)"
        subtitle="Émission, rotation et révocation des clés API. Chaque clé est rattachée à une organisation : ouvrez l'onglet « Clés API » de l'org concernée pour gérer ses identifiants."
      />

      <Card>
        <CardContent className="flex items-start gap-3 p-4">
          <KeyRound className="mt-0.5 h-5 w-5 text-teranga-gold" aria-hidden="true" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-foreground">
              Comment émettre une clé ?
            </p>
            <ol className="list-inside list-decimal space-y-0.5 text-muted-foreground">
              <li>
                Identifiez l&apos;organisation cliente (ci-dessous, ou via{" "}
                <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
                  ⌘K
                </kbd>
                ).
              </li>
              <li>Ouvrez son onglet « Clés API ».</li>
              <li>
                Cliquez sur « Émettre une clé », nommez-la, sélectionnez les scopes minimum.
              </li>
              <li>Copiez le secret affiché — il n&apos;est plus jamais récupérable.</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      <SectionHeader
        kicker="— Organisations"
        title="Comptes Enterprise"
        subtitle="Toutes les organisations sur le plan enterprise. La feature apiAccess y est activée par défaut."
      />

      {isLoading && (
        <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
          <Spinner />
        </div>
      )}

      {isError && (
        <InlineErrorBanner
          severity="destructive"
          kicker="— Erreur"
          title="Impossible de charger les organisations enterprise"
          description={error instanceof Error ? error.message : "Erreur inconnue"}
          actions={[{ label: "Réessayer", onClick: () => void refetch() }]}
        />
      )}

      {!isLoading && !isError && (
        <>
          {(data?.data ?? []).length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
                <Building2 className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <div className="text-sm font-semibold text-foreground">
                  Aucune organisation enterprise pour le moment
                </div>
                <div className="max-w-sm text-xs text-muted-foreground">
                  Quand un client passera sur le plan enterprise, il apparaîtra ici. Les overrides{" "}
                  <code className="font-mono text-[11px]">apiAccess</code> sur d&apos;autres plans restent gérables via la page détail de l&apos;org.
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="divide-y divide-border rounded-xl border border-border">
              {data!.data.map((org) => (
                <Link
                  key={org.id}
                  href={`/admin/organizations/${encodeURIComponent(org.id)}?tab=api-keys`}
                  className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Building2
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{org.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {org.id} · créée le{" "}
                        {new Date(org.createdAt).toLocaleDateString("fr-SN")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="success">Enterprise</Badge>
                    <ArrowRight
                      className="h-4 w-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
