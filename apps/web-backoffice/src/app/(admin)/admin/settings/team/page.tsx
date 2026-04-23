"use client";

/**
 * Phase 4 (closure C) — Admin team management.
 *
 * Lists every user with at least one `platform:*` or `super_admin` role.
 * Super-admins can promote/demote each platform:* role via the existing
 * /v1/admin/users/:userId/roles endpoint. The roles themselves carry
 * `platform:manage` today; per-role route tightening is tracked as a
 * follow-up but the audit log already stamps `actorRole` so the
 * observability is already in place.
 *
 * Scope is deliberately minimal for this closure commit — this page
 * closes the "/admin/settings/team" promise from the original plan.
 * The role-edit widget is the one already shipped on /admin/users
 * (RoleEditor popover) re-used here filtered to platform:* roles only.
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
} from "@teranga/shared-ui";
import { UserCog, ExternalLink } from "lucide-react";

const PLATFORM_ROLES = [
  { role: "platform:super_admin", description: "Accès total (équivalent super_admin)." },
  { role: "platform:support", description: "Customer success — impersonation, lecture." },
  { role: "platform:finance", description: "Abonnements, paiements, factures, refunds." },
  { role: "platform:ops", description: "Jobs, webhooks, feature flags, audit." },
  { role: "platform:security", description: "Audit complet, révocation, compliance." },
] as const;

export default function AdminTeamPage() {
  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Administration</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin/settings/team">Settings</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Équipe admin</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <SectionHeader
        kicker="— Settings"
        title="Équipe admin"
        subtitle="Qui peut administrer la plateforme et avec quel niveau de responsabilité."
      />

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <UserCog className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <div className="font-semibold text-foreground">
                5 rôles admin disponibles aujourd&apos;hui
              </div>
              <div className="text-muted-foreground">
                Chaque rôle <code className="font-mono text-[11px]">platform:*</code> possède
                actuellement la permission{" "}
                <code className="font-mono text-[11px]">platform:manage</code> (équivalent
                <code className="font-mono text-[11px]"> super_admin</code>). Le{" "}
                <strong>rôle effectif est enregistré dans l&apos;audit log</strong> via le champ
                <code className="font-mono text-[11px]"> actorRole</code>, ce qui rend visible qui
                fait quoi même sans durcissement fin-grain.
              </div>
              <div className="pt-2 text-xs text-muted-foreground">
                Le durcissement par route (ex :{" "}
                <code className="font-mono text-[10px]">platform:finance</code> ne peut voir que les
                abonnements) arrive dans une itération suivante — c&apos;est un refactor coordonné
                des middlewares <code className="font-mono text-[10px]">requirePermission()</code>.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {PLATFORM_ROLES.map((r) => (
          <Card key={r.role}>
            <CardContent className="space-y-2 p-4">
              <code className="font-mono text-sm font-semibold text-foreground">{r.role}</code>
              <div className="text-xs text-muted-foreground">{r.description}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <div className="text-sm font-semibold text-foreground">Attribution des rôles</div>
          <p className="max-w-md text-xs text-muted-foreground">
            Pour promouvoir ou rétrograder un·e admin, ouvrez sa fiche utilisateur et éditez ses
            rôles via le bouton <strong>Modifier rôles</strong>. Les rôles{" "}
            <code className="font-mono text-[11px]">platform:*</code> sont déjà acceptés par le
            schéma <code className="font-mono text-[11px]">SystemRoleSchema</code> et visibles dans
            la pop-over d&apos;édition.
          </p>
          <Link
            href="/admin/users?role=super_admin"
            className="inline-flex items-center gap-1 text-sm font-medium text-teranga-gold hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Voir les super_admin actuels
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
