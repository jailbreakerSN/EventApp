"use client";

/**
 * Phase D — Enterprise API keys (skeleton).
 *
 * The apiAccess feature is sold as part of the Enterprise plan
 * (PLAN_DISPLAY.enterprise.features.apiAccess = true) but no key
 * issuance mechanism exists on the backend yet. This page closes the
 * sidebar entry with an honest "in progress" state pointing to the
 * feature flag documentation + deep-linking to the enterprise orgs
 * list, so an admin can at least verify which orgs have the capability
 * flagged.
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
import { KeyRound, ArrowRight } from "lucide-react";

export default function AdminApiKeysPage() {
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
        subtitle="Gestion des clés d'accès API pour les clients enterprise."
      />
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <div className="font-semibold text-foreground">
                Issuance console en construction (Phase 6.3 du plan)
              </div>
              <div className="text-muted-foreground">
                Le feature <code className="font-mono text-[11px]">apiAccess</code> est déjà exposé
                aux orgs enterprise via <code className="font-mono text-[11px]">PLAN_DISPLAY</code>.
                L&apos;émission et la rotation de clés (scopes read / write / admin, affichage
                unique à la création) seront livrées ici. Aucune clé n&apos;est active
                aujourd&apos;hui.
              </div>
            </div>
          </div>
          <Link
            href="/admin/organizations?plan=enterprise"
            className="inline-flex items-center gap-1 text-sm font-medium text-teranga-gold hover:underline"
          >
            Voir les orgs enterprise <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
