"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  useAdminOrganizations,
  useBulkUpdateOrgStatus,
  useVerifyOrganization,
  useUpdateOrgStatus,
} from "@/hooks/use-admin";
import { useBulkSelection } from "@/hooks/use-bulk-selection";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useRowKeyboardNav } from "@/hooks/use-row-keyboard-nav";
import { BulkActionBar } from "@/components/admin/bulk-action-bar";
import { SavedViewsBar } from "@/components/admin/saved-views-bar";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  Input,
  Badge,
  Button,
  Select,
  DataTable,
  type DataTableColumn,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  SectionHeader,
  StatusPill,
} from "@teranga/shared-ui";
import { Search, ShieldCheck, Ban, CheckCircle, XCircle, Sparkles } from "lucide-react";
import type { Organization } from "@teranga/shared-types";
import { useTranslations } from "next-intl";
import { AssignPlanDialog } from "@/components/admin/AssignPlanDialog";

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
  const tCommon = useTranslations("common");
  void tCommon;
  const router = useRouter();
  // Hydrate the verified filter from the URL so the inbox deep-link
  // `/admin/organizations?isVerified=false` (emitted by the
  // "X organisation(s) non vérifiée(s)" signal in
  // `admin.service.ts:getInboxSignals`) actually applies the filter.
  // Accepts "true" / "false" strings; anything else falls back to the
  // unfiltered "" empty state.
  const searchParams = useSearchParams();
  const rawVerified = searchParams?.get("isVerified");
  const initialVerified = rawVerified === "true" || rawVerified === "false" ? rawVerified : "";
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [planFilter, setPlanFilter] = useState("");
  const [verifiedFilter, setVerifiedFilter] = useState(initialVerified);
  const [page, setPage] = useState(1);
  const limit = 20;

  // Reset to page 1 whenever a filter or the debounced query changes.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, planFilter, verifiedFilter]);

  const { data, isLoading } = useAdminOrganizations({
    q: debouncedSearch || undefined,
    plan: planFilter || undefined,
    isVerified: verifiedFilter === "" ? undefined : verifiedFilter === "true",
    page,
    limit,
  });

  const organizations: Organization[] = data?.data ?? [];
  const meta = data?.meta ?? { page: 1, limit, total: 0, totalPages: 1 };

  // B2 — row keyboard nav. Same pattern as /admin/users.
  const { activeIndex, setActiveIndex } = useRowKeyboardNav({
    items: organizations,
    onSelect: (o) => router.push(`/admin/organizations/${encodeURIComponent(o.id)}`),
  });

  const verifyOrg = useVerifyOrganization();
  const updateOrgStatus = useUpdateOrgStatus();
  const bulkUpdateStatus = useBulkUpdateOrgStatus();

  // Same page-scoped selection pattern as /admin/users.
  const orgPageIds = organizations.map((o) => o.id);
  const bulk = useBulkSelection<string>(orgPageIds);

  const [assignTarget, setAssignTarget] = useState<Organization | null>(null);

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

  const handleBulkUpdateStatus = (isActive: boolean) => {
    const ids = Array.from(bulk.selectedIds);
    if (ids.length === 0) return;
    const verb = isActive ? "réactiver" : "suspendre";
    if (
      !window.confirm(
        `Confirmer : ${verb} ${ids.length} organisation${ids.length > 1 ? "s" : ""} ? ` +
          `Cette action est auditée individuellement. Suspendre bloque aussi l'accès des ` +
          `membres, à utiliser avec prudence.`,
      )
    ) {
      return;
    }
    bulkUpdateStatus.mutate(
      { ids, isActive },
      {
        onSuccess: (res) => {
          const ok = res.data?.succeeded.length ?? 0;
          const ko = res.data?.failed.length ?? 0;
          if (ko > 0) {
            toast.error(
              `Bulk ${verb} partiel : ${ok} réussi${ok > 1 ? "s" : ""}, ${ko} échoué${ko > 1 ? "s" : ""}. ` +
                `Premier échec : ${res.data?.failed[0]?.reason ?? "inconnu"}.`,
            );
          } else {
            toast.success(`${ok} organisation${ok > 1 ? "s" : ""} ${verb}${ok > 1 ? "s" : ""}.`);
          }
          bulk.clear();
        },
        onError: (err) => {
          toast.error(
            `Bulk ${verb} échoué : ${err instanceof Error ? err.message : "erreur inconnue"}`,
          );
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
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
      <SectionHeader
        kicker="— ADMINISTRATION"
        title="Gestion des organisations"
        subtitle="Vérifiez, suspendez et assignez des plans aux organisations de la plateforme."
        size="hero"
        as="h1"
      />

      {/* T3.2 — Saved views chip bar. */}
      <SavedViewsBar surfaceKey="admin-organizations" />

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
          <DataTable<Organization & Record<string, unknown>>
            aria-label="Liste des organisations"
            emptyMessage="Aucune organisation trouvee"
            responsiveCards
            loading={isLoading}
            data={organizations as (Organization & Record<string, unknown>)[]}
            // Whole-row click → org detail. Middle-click on the name
            // Link opens in a new tab (see primary column below).
            onRowClick={(o) => router.push(`/admin/organizations/${encodeURIComponent(o.id)}`)}
            activeRowIndex={activeIndex}
            onRowHover={setActiveIndex}
            columns={
              [
                {
                  key: "__select",
                  header: (
                    <input
                      type="checkbox"
                      aria-label="Sélectionner toute la page"
                      checked={bulk.selectAllChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = bulk.selectAllState === "some";
                      }}
                      onChange={(e) => bulk.toggleAll(e.target.checked)}
                      className="h-4 w-4 cursor-pointer rounded border-border"
                    />
                  ),
                  hideOnMobile: true,
                  // Checkbox is a bulk-selection gesture, not row
                  // navigation — gate it from the row onClick.
                  stopRowNavigation: true,
                  render: (org) => (
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner ${org.name}`}
                      checked={bulk.isSelected(org.id)}
                      onChange={(e) => bulk.toggle(org.id, e.target.checked)}
                      className="h-4 w-4 cursor-pointer rounded border-border"
                    />
                  ),
                },
                {
                  key: "name",
                  header: "Nom",
                  primary: true,
                  render: (org) => (
                    <div>
                      <Link
                        href={`/admin/organizations/${encodeURIComponent(org.id)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {org.name}
                      </Link>
                      {org.city && (
                        <p className="text-xs text-muted-foreground">
                          {org.city}, {org.country}
                        </p>
                      )}
                    </div>
                  ),
                },
                {
                  key: "plan",
                  header: "Plan",
                  render: (org) => (
                    <Badge variant={PLAN_BADGE_VARIANTS[org.plan] ?? "neutral"}>
                      {PLAN_LABELS[org.plan] ?? org.plan}
                    </Badge>
                  ),
                },
                {
                  key: "isVerified",
                  header: "Verifie",
                  render: (org) =>
                    org.isVerified ? (
                      <ShieldCheck className="h-5 w-5 text-teranga-green" aria-label="Verifie" />
                    ) : (
                      <XCircle className="h-5 w-5 text-muted-foreground" aria-label="Non verifie" />
                    ),
                },
                {
                  key: "status",
                  header: "Statut",
                  render: (org) =>
                    org.isActive ? (
                      <StatusPill tone="success" label="Actif" />
                    ) : (
                      <StatusPill tone="danger" label="Suspendu" />
                    ),
                },
                {
                  key: "memberCount",
                  header: "Membres",
                  hideOnMobile: true,
                  render: (org) => (
                    <span className="font-medium text-foreground">{org.memberIds.length}</span>
                  ),
                },
                {
                  key: "actions",
                  header: "Actions",
                  // Action buttons own their click semantics; row-click
                  // navigation must not fire on top of them.
                  stopRowNavigation: true,
                  render: (org) => (
                    <div className="flex items-center justify-end gap-2 flex-wrap">
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
                        onClick={() => setAssignTarget(org)}
                        aria-label={`Assigner un plan à ${org.name}`}
                      >
                        <Sparkles className="h-3.5 w-3.5 mr-1" />
                        Assigner plan
                      </Button>
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
                  ),
                },
              ] as DataTableColumn<Organization & Record<string, unknown>>[]
            }
          />
        </CardContent>
      </Card>

      {/* Bulk action bar — appears when ≥ 1 org selected. */}
      <BulkActionBar
        count={bulk.size}
        onClear={bulk.clear}
        entityLabel={{
          singular: "organisation sélectionnée",
          plural: "organisations sélectionnées",
        }}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleBulkUpdateStatus(true)}
          disabled={bulkUpdateStatus.isPending}
        >
          Réactiver
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => handleBulkUpdateStatus(false)}
          disabled={bulkUpdateStatus.isPending}
        >
          Suspendre
        </Button>
      </BulkActionBar>

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

      {/* Assign-plan dialog (Phase 5: per-org override) */}
      {assignTarget && (
        <AssignPlanDialog
          open={!!assignTarget}
          org={assignTarget}
          onClose={() => setAssignTarget(null)}
        />
      )}
    </div>
  );
}
