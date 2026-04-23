"use client";

/**
 * Phase B (P3 closure) — Admin event detail page.
 *
 * Mirrors the <EntityDetailLayout> contract already used by
 * /admin/organizations/[orgId] and /admin/users/[userId] so the admin has
 * one predictable navigation metaphor across all entity detail pages.
 *
 * Tabs:
 *   - Aperçu        : core event metadata + status + venue + capacity
 *   - Participants  : deep-link to registrations list filtered on this event
 *   - Paiements     : deep-link to audit action=payment.* filtered on event
 *   - Audit         : deep-link to audit filtered on resourceType=event
 *
 * No inline lists in this first cut — the deep-linking pattern already
 * established in the P3 baseline avoids duplicating pagination logic and
 * keeps the detail page cheap to load.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Badge, Card, CardContent, Skeleton, InlineErrorBanner } from "@teranga/shared-ui";
import { Calendar, MapPin, Users, Receipt, Clock, ExternalLink, Building2 } from "lucide-react";
import type { Event } from "@teranga/shared-types";
import { eventsApi } from "@/lib/api-client";
import { EntityDetailLayout } from "@/components/admin/entity-detail-layout";
import { useErrorHandler } from "@/hooks/use-error-handler";

export default function AdminEventDetailPage() {
  const params = useParams<{ eventId: string }>();
  const router = useRouter();
  const { resolve } = useErrorHandler();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvent = useCallback(async () => {
    try {
      setLoading(true);
      const res = await eventsApi.getById(params.eventId);
      setEvent(res.data);
      setError(null);
    } catch (err) {
      setError(resolve(err).description);
    } finally {
      setLoading(false);
    }
  }, [params.eventId, resolve]);

  useEffect(() => {
    void fetchEvent();
  }, [fetchEvent]);

  if (loading && !event) {
    return (
      <div className="container mx-auto max-w-6xl space-y-6 p-6">
        <Skeleton variant="text" className="h-4 w-64" />
        <Skeleton variant="text" className="h-8 w-80" />
        <Skeleton variant="text" className="h-96 w-full" />
      </div>
    );
  }

  if (error && !event) {
    return (
      <div className="container mx-auto max-w-4xl p-6">
        <InlineErrorBanner
          severity="destructive"
          kicker="— Erreur"
          title="Impossible de charger l'événement"
          description={error}
        />
        <button
          type="button"
          onClick={() => router.push("/admin/events")}
          className="mt-4 text-sm text-teranga-gold hover:underline"
        >
          ← Retour à la liste
        </button>
      </div>
    );
  }

  if (!event) return null;

  return (
    <EntityDetailLayout
      breadcrumbs={[
        { label: "Administration", href: "/admin" },
        { label: "Événements", href: "/admin/events" },
        { label: event.title },
      ]}
      title={event.title}
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-2">
          <code className="font-mono text-[11px]">{event.slug}</code>
          <span aria-hidden="true">·</span>
          <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
          <Link
            href={`/admin/organizations/${event.organizationId}`}
            className="text-teranga-gold hover:underline"
          >
            {event.organizationId}
          </Link>
        </span>
      }
      pills={
        <>
          <Badge variant={statusVariant(event.status)}>{event.status}</Badge>
          <Badge variant="outline" className="text-[10px]">
            {event.format}
          </Badge>
          {event.isFeatured && (
            <Badge variant="info" className="text-[10px]">
              Mis en avant
            </Badge>
          )}
        </>
      }
      quickActions={[
        {
          id: "public-link",
          label: "Voir côté participant",
          icon: <ExternalLink className="h-4 w-4" aria-hidden="true" />,
          onClick: () => window.open(`/events/${event.slug}`, "_blank"),
        },
      ]}
      tabs={[
        { id: "overview", label: "Aperçu", render: () => <OverviewTab event={event} /> },
        {
          id: "participants",
          label: "Participants",
          count: event.registeredCount,
          render: () => <ParticipantsTab event={event} />,
        },
        { id: "payments", label: "Paiements", render: () => <PaymentsTab event={event} /> },
        { id: "audit", label: "Audit", render: () => <AuditTab event={event} /> },
      ]}
    />
  );
}

function statusVariant(status: string): "success" | "outline" | "destructive" | "secondary" {
  switch (status) {
    case "published":
      return "success";
    case "draft":
      return "outline";
    case "cancelled":
      return "destructive";
    default:
      return "secondary";
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("fr-SN", { dateStyle: "medium", timeStyle: "short" });
}

function OverviewTab({ event }: { event: Event }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardContent className="space-y-3 p-4 text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Dates
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span>{fmtDate(event.startDate)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span>Fin : {fmtDate(event.endDate)}</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span>{event.location?.name ?? "—"}</span>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-2 p-4 text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Capacité
          </div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {event.registeredCount} / {event.maxAttendees ?? "∞"} inscrit·e·s
          </div>
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {event.ticketTypes?.length ?? 0} type(s) de billet
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ParticipantsTab(_props: { event: Event }) {
  return (
    <DeepLinkCard
      icon={<Users className="h-8 w-8" aria-hidden="true" />}
      title="Liste des inscriptions"
      description="Consultez les participants filtrés sur cet événement dans le flux audit ou l'export CSV."
      href={`/admin/audit?resourceType=registration&action=registration.created`}
      label={`Voir via audit →`}
    />
  );
}

function PaymentsTab(_props: { event: Event }) {
  return (
    <DeepLinkCard
      icon={<Receipt className="h-8 w-8" aria-hidden="true" />}
      title="Paiements liés"
      description="Consultez les transactions via le journal d'audit (actions payment.*)."
      href={`/admin/audit?action=payment.succeeded`}
      label={`Ouvrir l'audit →`}
    />
  );
}

function AuditTab(_props: { event: Event }) {
  return (
    <DeepLinkCard
      icon={<Calendar className="h-8 w-8" aria-hidden="true" />}
      title="Audit filtré sur cet événement"
      description="Timeline des actions admin et système touchant cet événement."
      href={`/admin/audit?resourceType=event`}
      label="Ouvrir l'audit →"
    />
  );
}

function DeepLinkCard({
  icon,
  title,
  description,
  href,
  label,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
  label: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
        <div className="text-muted-foreground">{icon}</div>
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="max-w-sm text-xs text-muted-foreground">{description}</div>
        <Link href={href} className="mt-2 text-sm font-medium text-teranga-gold hover:underline">
          {label}
        </Link>
      </CardContent>
    </Card>
  );
}
