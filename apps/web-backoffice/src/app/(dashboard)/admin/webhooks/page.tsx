"use client";

/**
 * Phase D — Admin webhooks observability placeholder.
 *
 * The notification dispatch log already carries the "did the email get
 * sent" story (admin/notifications → Délivrance). This page is the
 * staging slot for a future Stripe / Wave / Orange Money webhooks
 * replay console. For now it ships an honest empty state + a deep
 * link to the Delivery Observability dashboard which today holds the
 * closest equivalent data.
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
import { Webhook, ArrowRight } from "lucide-react";

export default function AdminWebhooksPage() {
  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Administration</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Webhooks</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <SectionHeader
        kicker="— Platform"
        title="Webhooks"
        subtitle="Observabilité des intégrations sortantes (notifications, paiements, FCM)."
      />
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-start gap-3">
            <Webhook className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <div className="font-semibold text-foreground">
                Console webhooks en construction (Phase 6.2 du plan)
              </div>
              <div className="text-muted-foreground">
                Les intégrations sortantes existantes sont déjà tracées dans{" "}
                <code className="font-mono text-[11px]">notificationDispatchLog</code> (Resend / FCM
                / SMS). Les webhooks entrants paiement (Wave, Orange Money) passeront par ici dès
                qu&apos;un replay console sera livré.
              </div>
            </div>
          </div>
          <Link
            href="/admin/notifications/delivery"
            className="inline-flex items-center gap-1 text-sm font-medium text-teranga-gold hover:underline"
          >
            Observabilité notifications <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
