"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useAdminOrganizations,
  useVerifyOrganization,
  useUpdateOrgStatus,
} from "@/hooks/use-admin";
import {
  Card,
  CardContent,
  Input,
  Badge,
  Button,
  Select,
  Skeleton,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@teranga/shared-ui";
import { Building2, Search, ShieldCheck, Ban, CheckCircle, XCircle } from "lucide-react";
import type { Organization } from "@teranga/shared-types";

// ─── Constants ──────────────────────────────────────────────────────────────

const PLAN_BADGE_VARIANTS: Record<
  string,
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info"
  | "pending"
  | "neutral"
  | "premium"
> = {
  free: "neutral",
  starter: "info",
  pro: "premium",
  enterprise: "warning",
};

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  enterprise: "Enterprise",
};

const VERIFIED_OPTIONS = [
  { value: "", label: "Tous" },
  { value: "true", label: "Verifie" },
  { value: "false", label: "Non verifie" },
] as const;

const PLAN_OPTIONS = [
  { value: "", label: "Tous les plans" },
  { value: "free", label: "Free" },
  { value: "starter", label: "Starter" },
  { value: "pro", label: "Pro" },
  { value: "enterprise", label: "Enterprise" },
] as const;

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AdminOrganizationsPage() {
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [verifiedFilter, setVerifiedFilter] = useState("");
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = useAdminOrganizations({
    q: search || undefined,
    plan: planFilter || undefined,
    isVerified: verifiedFilter === "" ? undefined : verifiedFilter === "true",
    page,
    limit,
  });

  const organizations: Organization[] = data?.data ?? [];
  const meta = data?.meta ?? { page: 1, limit, total: 0, totalPages: 1 };

  const verifyOrg = useVerifyOrganization();
  const updateOrgStatus = useUpdateOrgStatus();

  const handleVerify = (org: Organization) => {
    if (!window.confirm(`Voulez-vous verifier l'organisation "${org.name}" ?`)) {
      return;
    }
    verifyOrg.mutate(org.id);
  };

  const handleToggleStatus = (org: Organization) => {
    const action = org.isActive ? "suspendre" : "reactiver";
    if (!window.confirm(`Voulez-vous ${action} l'organisation "${org.name}" ?`)) {
      return;
    }
    updateOrgStatus.mutate({ orgId: org.id, isActive: !org.isActive });
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin">Tableau de bord</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin">Administration</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Organisations</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-center gap-3">
        <Building2 className="h-7 w-7 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Gestion des organisations</h1>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher par nom..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
            aria-label="Rechercher des organisations"
          />
        </div>

        <div className="flex gap-3">
          <div>
            <label
              htmlFor="plan-filter"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Plan
            </label>
            <Select
              id="plan-filter"
              value={planFilter}
              onChange={(e) => {
                setPlanFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Filtrer par plan"
            >
              {PLAN_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label
              htmlFor="verified-filter"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Verification
            </label>
            <Select
              id="verified-filter"
              value={verifiedFilter}
              onChange={(e) => {
                setVerifiedFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Filtrer par statut de verification"
            >
              {VERIFIED_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {/* Data Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Liste des organisations">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nom</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Plan</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                    Verifie
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Statut</th>
                  <th className="px-4 py-3 text-center font-medium text-muted-foreground">
                    Membres
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      <td className="px-4 py-3">
                        <Skeleton className="h-4 w-40 mb-1" />
                        <Skeleton className="h-3 w-28" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="h-5 w-16" />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Skeleton className="mx-auto h-5 w-5" variant="circle" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="h-5 w-16" />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Skeleton className="mx-auto h-4 w-8" />
                      </td>
                      <td className="px-4 py-3">
                        <Skeleton className="h-8 w-32 ml-auto" />
                      </td>
                    </tr>
                  ))}

                {!isLoading && organizations.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      <Building2 className="mx-auto mb-2 h-8 w-8 opacity-40" />
                      Aucune organisation trouvee
                    </td>
                  </tr>
                )}

                {!isLoading &&
                  organizations.map((org) => (
                    <tr
                      key={org.id}
                      className="border-b border-border hover:bg-muted/30 transition-colors"
                    >
                      {/* Name */}
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{org.name}</p>
                        {org.city && (
                          <p className="text-xs text-muted-foreground">
                            {org.city}, {org.country}
                          </p>
                        )}
                      </td>

                      {/* Plan */}
                      <td className="px-4 py-3">
                        <Badge variant={PLAN_BADGE_VARIANTS[org.plan] ?? "neutral"}>
                          {PLAN_LABELS[org.plan] ?? org.plan}
                        </Badge>
                      </td>

                      {/* Verified */}
                      <td className="px-4 py-3 text-center">
                        {org.isVerified ? (
                          <ShieldCheck
                            className="mx-auto h-5 w-5 text-emerald-600 dark:text-emerald-400"
                            aria-label="Verifie"
                          />
                        ) : (
                          <XCircle
                            className="mx-auto h-5 w-5 text-muted-foreground"
                            aria-label="Non verifie"
                          />
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        {org.isActive ? (
                          <Badge variant="success">Actif</Badge>
                        ) : (
                          <Badge variant="destructive">Suspendu</Badge>
                        )}
                      </td>

                      {/* Members */}
                      <td className="px-4 py-3 text-center font-medium text-foreground">
                        {org.memberIds.length}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {!org.isVerified && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleVerify(org)}
                              disabled={verifyOrg.isPending}
                              aria-label={`Verifier ${org.name}`}
                            >
                              <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                              Verifier
                            </Button>
                          )}

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleToggleStatus(org)}
                            disabled={updateOrgStatus.isPending}
                            aria-label={
                              org.isActive ? `Suspendre ${org.name}` : `Reactiver ${org.name}`
                            }
                          >
                            {org.isActive ? (
                              <>
                                <Ban className="h-3.5 w-3.5 mr-1" />
                                Suspendre
                              </>
                            ) : (
                              <>
                                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                Reactiver
                              </>
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {!isLoading && meta.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {meta.page} sur {meta.totalPages} ({meta.total} organisation
            {meta.total > 1 ? "s" : ""})
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="Page precedente"
            >
              Precedent
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
              disabled={page >= meta.totalPages}
              aria-label="Page suivante"
            >
              Suivant
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
