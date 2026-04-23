"use client";

/**
 * Phase 1 — Admin inbox skeleton.
 *
 * This is the landing page an admin lands on when they go to /admin. Phase 2
 * of the admin overhaul populates each card with live data; for now we ship
 * the information architecture + visual shell so the nav story is coherent
 * end-to-end.
 *
 * Cards are organised by domain (Modération, Comptes, Billing, Ops, Events
 * live) matching the SaaS admin "inbox-first" pattern from Stripe / Linear.
 * Each card eventually renders a count + short description + CTA that deep-
 * links to the filtered list. A "Tout va bien" state is shown when zero
 * alerts fire across all sections — avoids the anxiety of an empty page.
 */

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
import { CheckCircle2, Construction } from "lucide-react";

export default function AdminInboxPage() {
  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Administration</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Ma boîte</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <SectionHeader
        kicker="— Administration"
        title="Ma boîte admin"
        subtitle="Ce qui demande votre attention aujourd'hui sur la plateforme"
      />

      {/* Placeholder — Phase 2 wires the live signals. */}
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <Construction className="h-10 w-10 text-teranga-gold" aria-hidden="true" />
          <div className="text-lg font-semibold text-foreground">Page en cours de construction</div>
          <p className="max-w-md text-sm text-muted-foreground">
            La boîte admin agrègera bientôt les signaux opérationnels (venues à modérer, paiements
            en attente, webhooks échoués, utilisateurs en désynchronisation). Pour l'instant,
            utilisez la barre latérale ou{" "}
            <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
              ⌘K
            </kbd>{" "}
            pour naviguer.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-teranga-green/10 px-3 py-1 text-xs font-medium text-teranga-green">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Tout va bien — aucun incident critique
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
