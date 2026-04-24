"use client";

/**
 * Admin platform-ops — cross-org invitations list.
 *
 * Was needed because the inbox card `invites.expired` linked to the
 * unfiltered `/admin/organizations`. The inbox count reads
 * `invites WHERE status=expired` directly; operators then had to
 * drill into each org's billing page and hunt for invites to relance
 * or purge — no aggregate list existed.
 *
 * This page is the canonical surface for the `invites.expired` card
 * and a general cleanup surface. Mirrors the pattern of /admin/venues
 * and /admin/payments — filter + table, row-click drills into the
 * owning org.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Card,
  CardContent,
  Badge,
  Button,
  Select,
  DataTable,
  type DataTableColumn,
} from "@teranga/shared-ui";
import {
  Mail,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import type { OrganizationInvite, InviteStatus, OrgMemberRole } from "@teranga/shared-types";
import { useAdminInvites } from "@/hooks/use-admin";

// Status dropdown options — value "" means "no filter applied". Keys
// match InviteStatusSchema exactly so hydrating `?status=expired` from
// the URL lines up with a real option. Any unknown URL value falls
// through to the empty default (no silent filter).
const STATUS_OPTIONS = [
  { value: "", label: "Tous les statuts" },
  { value: "pending", label: "En attente" },
  { value: "accepted", label: "Acceptée" },
  { value: "declined", label: "Refusée" },
  { value: "expired", label: "Expirée" },
] as const;

const ROLE_OPTIONS = [
  { value: "", label: "Tous les rôles" },
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
] as const;

const STATUS_BADGE: Record<
  string,
  {
    variant: "default" | "secondary" | "destructive" | "success" | "warning" | "outline";
    icon: typeof CheckCircle2;
    label: string;
  }
> = {
  pending: { variant: "warning", icon: Clock, label: "En attente" },
  accepted: { variant: "success", icon: CheckCircle2, label: "Acceptée" },
  declined: { variant: "outline", icon: XCircle, label: "Refusée" },
  expired: { variant: "destructive", icon: AlertTriangle, label: "Expirée" },
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export default function AdminInvitesPage() {
  const router = useRouter();
  // Hydrate filters from the URL so the inbox deep-link
  // `/admin/invites?status=expired` lands in the filtered view —
  // same pattern as /admin/venues, /admin/payments,
  // /admin/subscriptions.
  const searchParams = useSearchParams();
  const rawStatus = searchParams?.get("status") ?? "";
  // Only accept values the dropdown knows about. Unknown values
  // (typos, stale bookmarks) fall through to the empty default so
  // the page never renders with a `status=bogus` query that the
  // backend would reject with 400.
  const initialStatus = STATUS_OPTIONS.some((o) => o.value === rawStatus) ? rawStatus : "";
  const rawRole = searchParams?.get("role") ?? "";
  const initialRole = ROLE_OPTIONS.some((o) => o.value === rawRole) ? rawRole : "";

  const [status, setStatus] = useState(initialStatus);
  const [role, setRole] = useState(initialRole);
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = useAdminInvites({
    status: (status || undefined) as InviteStatus | undefined,
    role: (role || undefined) as OrgMemberRole | undefined,
    page,
    limit,
  });

  const invites: OrganizationInvite[] = data?.data ?? [];
  const meta = data?.meta ?? { page: 1, limit, total: 0, totalPages: 1 };

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/admin">Administration</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Invitations</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-wrap items-center gap-3">
        <Mail className="h-7 w-7 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-bold text-foreground">Invitations</h1>
        {status === "expired" && (
          <Badge variant="destructive" className="ml-1">
            Filtre : expirées
          </Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Vue ops cross-organisations des invitations. Ouvrir la fiche de l&apos;organisation pour
        relancer ou révoquer.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        <div className="w-full sm:w-56">
          <label
            htmlFor="inv-status"
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
          >
            Statut
          </label>
          <Select
            id="inv-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            aria-label="Filtrer par statut"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-56">
          <label
            htmlFor="inv-role"
            className="mb-1.5 block text-xs font-medium text-muted-foreground"
          >
            Rôle proposé
          </label>
          <Select
            id="inv-role"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setPage(1);
            }}
            aria-label="Filtrer par rôle"
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <DataTable<OrganizationInvite & Record<string, unknown>>
            aria-label="Liste des invitations"
            emptyMessage="Aucune invitation trouvée"
            responsiveCards
            loading={isLoading}
            data={invites as (OrganizationInvite & Record<string, unknown>)[]}
            onRowClick={(inv) => {
              // Org detail is the canonical action surface for invites
              // — the org billing / members tabs expose resend / revoke
              // controls. Admin doesn't need its own mutation UI here.
              if (inv.organizationId) {
                router.push(`/admin/organizations/${encodeURIComponent(inv.organizationId)}`);
              }
            }}
            columns={
              [
                {
                  key: "status",
                  header: "Statut",
                  primary: true,
                  render: (inv) => {
                    const meta = STATUS_BADGE[inv.status] ?? STATUS_BADGE.pending;
                    const Icon = meta.icon;
                    return (
                      <Badge variant={meta.variant} className="gap-1">
                        <Icon className="h-3 w-3" aria-hidden="true" />
                        {meta.label}
                      </Badge>
                    );
                  },
                },
                {
                  key: "email",
                  header: "Destinataire",
                  render: (inv) => (
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{inv.email}</span>
                      <span className="text-xs text-muted-foreground">
                        Rôle proposé :{" "}
                        <strong className="text-foreground">{inv.role}</strong>
                      </span>
                    </div>
                  ),
                },
                {
                  key: "organization",
                  header: "Organisation",
                  hideOnMobile: true,
                  render: (inv) => (
                    <Link
                      href={`/admin/organizations/${encodeURIComponent(inv.organizationId)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm text-muted-foreground hover:text-teranga-gold hover:underline"
                    >
                      {inv.organizationName ?? inv.organizationId}
                    </Link>
                  ),
                },
                {
                  key: "invitedBy",
                  header: "Invité par",
                  hideOnMobile: true,
                  render: (inv) => (
                    <span className="text-xs text-muted-foreground">
                      {inv.invitedByName ?? inv.invitedBy.slice(0, 12)}
                    </span>
                  ),
                },
                {
                  key: "expiresAt",
                  header: "Expire",
                  render: (inv) => (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(inv.expiresAt)}
                    </span>
                  ),
                },
              ] as DataTableColumn<OrganizationInvite & Record<string, unknown>>[]
            }
          />
        </CardContent>
      </Card>

      {!isLoading && meta.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {meta.page} sur {meta.totalPages} ({meta.total} invitation
            {meta.total > 1 ? "s" : ""})
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="Page précédente"
            >
              Précédent
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
