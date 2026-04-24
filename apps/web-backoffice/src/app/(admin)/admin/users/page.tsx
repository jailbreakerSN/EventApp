"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  useAdminUsers,
  useBulkUpdateUserStatus,
  useUpdateUserRoles,
  useUpdateUserStatus,
} from "@/hooks/use-admin";
import { useBulkSelection } from "@/hooks/use-bulk-selection";
import { BulkActionBar } from "@/components/admin/bulk-action-bar";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  Input,
  Badge,
  Spinner,
  Button,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  DataTable,
  type DataTableColumn,
} from "@teranga/shared-ui";
import { Users, Shield, Search, Ban, CheckCircle, AlertTriangle } from "lucide-react";
import type { AdminUserRow } from "@teranga/shared-types";
import { useTranslations } from "next-intl";

// ─── Constants ──────────────────────────────────────────────────────────────

const ROLE_FILTERS = [
  { value: "", label: "Tous" },
  { value: "organizer", label: "Organizer" },
  { value: "participant", label: "Participant" },
  { value: "super_admin", label: "Super Admin" },
  { value: "venue_manager", label: "Venue Manager" },
] as const;

const ROLE_BADGE_VARIANTS: Record<
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
  super_admin: "destructive",
  organizer: "info",
  co_organizer: "info",
  participant: "neutral",
  venue_manager: "success",
  staff: "warning",
  speaker: "premium",
  sponsor: "pending",
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  organizer: "Organisateur",
  participant: "Participant",
  venue_manager: "Gestionnaire lieu",
  staff: "Staff",
  co_organizer: "Co-organisateur",
  speaker: "Intervenant",
  sponsor: "Sponsor",
};

const ALL_ROLES = [
  "super_admin",
  "organizer",
  "co_organizer",
  "participant",
  "venue_manager",
  "staff",
  "speaker",
  "sponsor",
];

// ─── JWT ↔ Firestore drift helpers ──────────────────────────────────────────
//
// API enriches each row with `claimsMatch`:
//   - { roles, organizationId, orgRole } all true → in sync, no warning.
//   - any of the three false → visible drift, render the badge.
//   - null → Auth record couldn't be fetched (Auth user deleted / Admin
//     SDK transient failure). Surface as drift too — admins need to
//     reconcile or purge the orphaned Firestore doc.

function hasClaimsDrift(user: AdminUserRow): boolean {
  if (user.claimsMatch === null) return true;
  const m = user.claimsMatch;
  return !m.roles || !m.organizationId || !m.orgRole;
}

function driftAriaLabel(user: AdminUserRow): string {
  if (user.claimsMatch === null) {
    return "Avertissement : la fiche Firebase Auth de cet utilisateur est introuvable. L'UI affiche l'état Firestore, mais les permissions appliquent le JWT — à réconcilier.";
  }
  const mismatches: string[] = [];
  if (!user.claimsMatch.roles) mismatches.push("rôles système");
  if (!user.claimsMatch.organizationId) mismatches.push("organisation");
  if (!user.claimsMatch.orgRole) mismatches.push("rôle dans l'organisation");
  return `Désynchronisation entre le JWT et Firestore sur : ${mismatches.join(", ")}. L'utilisateur doit se reconnecter, ou relancer la dernière modification si elle a échoué à mi-course.`;
}

// ─── Role Editor Popover ────────────────────────────────────────────────────

function RoleEditor({
  user,
  onSave,
  isSaving,
}: {
  user: AdminUserRow;
  onSave: (roles: string[]) => void;
  isSaving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(user.roles);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(user.roles);
  }, [open, user.roles]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const toggleRole = (role: string) => {
    setSelected((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const handleSave = () => {
    if (selected.length === 0) return;
    onSave(selected);
    setOpen(false);
  };

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        aria-label={`Modifier les roles de ${user.displayName}`}
        aria-expanded={open}
      >
        <Shield className="h-3.5 w-3.5 mr-1" />
        Modifier roles
      </Button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border border-border bg-card p-3 shadow-lg"
          role="dialog"
          aria-label="Modifier les roles"
        >
          <p className="mb-2 text-xs font-medium text-muted-foreground">Selectionner les roles</p>
          <div className="space-y-1.5">
            {ALL_ROLES.map((role) => (
              <label key={role} className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(role)}
                  onChange={() => toggleRole(role)}
                  className="rounded border-input"
                  aria-label={ROLE_LABELS[role] ?? role}
                />
                <span>{ROLE_LABELS[role] ?? role}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving || selected.length === 0}>
              {isSaving ? <Spinner size="sm" /> : "Enregistrer"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const tCommon = useTranslations("common");
  void tCommon;
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = useAdminUsers({
    q: search || undefined,
    role: roleFilter || undefined,
    page,
    limit,
  });

  const users: AdminUserRow[] = data?.data ?? [];
  const meta = data?.meta ?? { page: 1, limit, total: 0, totalPages: 1 };

  const updateRoles = useUpdateUserRoles();
  const updateStatus = useUpdateUserStatus();
  const bulkUpdateStatus = useBulkUpdateUserStatus();

  // Selection state is scoped to the current page. Switching pages or
  // filters deliberately resets the selection set via pageIds reference,
  // so operators cannot accidentally suspend rows they can no longer see.
  const pageIds = users.map((u) => u.uid);
  const bulk = useBulkSelection<string>(pageIds);

  const handleToggleStatus = (user: AdminUserRow) => {
    const action = user.isActive ? "suspendre" : "reactiver";
    if (!window.confirm(`Voulez-vous ${action} l'utilisateur "${user.displayName}" ?`)) {
      return;
    }
    updateStatus.mutate({ userId: user.uid, isActive: !user.isActive });
  };

  const handleBulkUpdateStatus = (isActive: boolean) => {
    const ids = Array.from(bulk.selectedIds);
    if (ids.length === 0) return;
    const verb = isActive ? "réactiver" : "suspendre";
    if (
      !window.confirm(
        `Confirmer : ${verb} ${ids.length} utilisateur${ids.length > 1 ? "s" : ""} ? ` +
          `Cette action est auditée individuellement et peut être lente (~${ids.length}× le ` +
          `temps d'une mutation unitaire).`,
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
            toast.success(`${ok} utilisateur${ok > 1 ? "s" : ""} ${verb}${ok > 1 ? "s" : ""}.`);
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

  const handleUpdateRoles = (userId: string, roles: string[]) => {
    updateRoles.mutate({ userId, roles });
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
            <BreadcrumbPage>Utilisateurs</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-center gap-3">
        <Users className="h-7 w-7 text-primary" />
        <h1 className="text-2xl font-bold text-foreground">Gestion des utilisateurs</h1>
      </div>

      {/* Search + Filters */}
      <div className="space-y-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher par nom ou email..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
            aria-label="Rechercher des utilisateurs"
          />
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par role">
          {ROLE_FILTERS.map((rf) => (
            <button
              key={rf.value}
              onClick={() => {
                setRoleFilter(rf.value);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                roleFilter === rf.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
              aria-pressed={roleFilter === rf.value}
            >
              {rf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Data Table */}
      <Card>
        <CardContent className="p-0">
          <DataTable<AdminUserRow & Record<string, unknown>>
            aria-label="Liste des utilisateurs"
            emptyMessage="Aucun utilisateur trouve"
            responsiveCards
            loading={isLoading}
            data={users as (AdminUserRow & Record<string, unknown>)[]}
            columns={
              [
                {
                  key: "__select",
                  // Header hosts the tri-state select-all checkbox. The
                  // `indeterminate` DOM property is set imperatively via
                  // ref since React's JSX `indeterminate` attribute does
                  // not propagate to the underlying HTMLInputElement.
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
                  render: (user) => (
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner ${user.displayName}`}
                      checked={bulk.isSelected(user.uid)}
                      onChange={(e) => bulk.toggle(user.uid, e.target.checked)}
                      className="h-4 w-4 cursor-pointer rounded border-border"
                    />
                  ),
                },
                {
                  key: "displayName",
                  header: "Nom / Email",
                  primary: true,
                  render: (user) => (
                    <div className="flex items-start gap-2">
                      <div>
                        <p className="font-medium text-foreground">{user.displayName}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                      {hasClaimsDrift(user) && (
                        <span
                          className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                          role="img"
                          aria-label={driftAriaLabel(user)}
                          title={driftAriaLabel(user)}
                        >
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                          JWT
                        </span>
                      )}
                    </div>
                  ),
                },
                {
                  key: "roles",
                  header: "Roles",
                  render: (user) => (
                    <div className="flex flex-wrap gap-1">
                      {user.roles.map((role) => (
                        <Badge key={role} variant={ROLE_BADGE_VARIANTS[role] ?? "neutral"}>
                          {ROLE_LABELS[role] ?? role}
                        </Badge>
                      ))}
                    </div>
                  ),
                },
                {
                  key: "status",
                  header: "Statut",
                  render: (user) =>
                    user.isActive ? (
                      <Badge variant="success">
                        <CheckCircle className="mr-1 h-3 w-3" />
                        Actif
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <Ban className="mr-1 h-3 w-3" />
                        Suspendu
                      </Badge>
                    ),
                },
                {
                  key: "actions",
                  header: "Actions",
                  render: (user) => (
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggleStatus(user)}
                        disabled={updateStatus.isPending}
                        aria-label={
                          user.isActive
                            ? `Suspendre ${user.displayName}`
                            : `Reactiver ${user.displayName}`
                        }
                      >
                        {user.isActive ? (
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
                      <RoleEditor
                        user={user}
                        onSave={(roles) => handleUpdateRoles(user.uid, roles)}
                        isSaving={updateRoles.isPending}
                      />
                    </div>
                  ),
                },
              ] as DataTableColumn<AdminUserRow & Record<string, unknown>>[]
            }
          />
        </CardContent>
      </Card>

      {/* Bulk action bar — appears when ≥ 1 row selected. */}
      <BulkActionBar
        count={bulk.size}
        onClear={bulk.clear}
        entityLabel={{
          singular: "utilisateur sélectionné",
          plural: "utilisateurs sélectionnés",
        }}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleBulkUpdateStatus(true)}
          disabled={bulkUpdateStatus.isPending}
        >
          <CheckCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Réactiver
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => handleBulkUpdateStatus(false)}
          disabled={bulkUpdateStatus.isPending}
        >
          <Ban className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Suspendre
        </Button>
      </BulkActionBar>

      {/* Pagination */}
      {!isLoading && meta.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {meta.page} sur {meta.totalPages} ({meta.total} utilisateur
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
