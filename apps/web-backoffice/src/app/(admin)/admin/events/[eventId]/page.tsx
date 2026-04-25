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
import {
  Badge,
  Card,
  CardContent,
  Skeleton,
  InlineErrorBanner,
  Spinner,
} from "@teranga/shared-ui";
import {
  Calendar,
  MapPin,
  Users,
  Receipt,
  Clock,
  ExternalLink,
  Building2,
  Repeat,
  Hourglass,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import type { Event } from "@teranga/shared-types";
import { eventsApi } from "@/lib/api-client";
import { EntityDetailLayout, type EntityTab } from "@/components/admin/entity-detail-layout";
import { useErrorHandler } from "@/hooks/use-error-handler";
import { useAdminEvents, useAdminEventWaitlistHealth } from "@/hooks/use-admin";

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

  // Phase 7+ B1 closure — series anchor surfaces an extra "Série"
  // tab listing its occurrences. We detect parents by the
  // `isRecurringParent` field; child events keep the same 4-tab
  // layout but their breadcrumb back-links the parent so admins can
  // navigate the series.
  const isParent = event.isRecurringParent === true;
  const parentLink = event.parentEventId
    ? { id: event.parentEventId, occurrenceIndex: event.occurrenceIndex }
    : null;

  const tabs: EntityTab[] = [
    { id: "overview", label: "Aperçu", render: () => <OverviewTab event={event} /> },
    {
      id: "participants",
      label: "Participants",
      count: event.registeredCount,
      render: () => <ParticipantsTab event={event} />,
    },
    {
      id: "waitlist",
      label: "Liste d'attente",
      render: () => <WaitlistTab eventId={event.id} />,
    },
    { id: "payments", label: "Paiements", render: () => <PaymentsTab event={event} /> },
    { id: "audit", label: "Audit", render: () => <AuditTab event={event} /> },
  ];
  if (isParent) {
    tabs.splice(1, 0, {
      id: "series",
      label: "Série",
      render: () => <SeriesTab parentEventId={event.id} />,
    });
  }

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
          {parentLink && (
            <>
              <span aria-hidden="true">·</span>
              <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
              <Link
                href={`/admin/events/${parentLink.id}?tab=series`}
                className="text-teranga-gold hover:underline"
              >
                Voir la série
                {typeof parentLink.occurrenceIndex === "number" &&
                  ` (occurrence ${parentLink.occurrenceIndex + 1})`}
              </Link>
            </>
          )}
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
          {isParent && (
            <Badge variant="info" className="text-[10px]">
              Série récurrente
            </Badge>
          )}
        </>
      }
      quickActions={[
        {
          id: "public-link",
          label: "Voir côté participant",
          icon: <ExternalLink className="h-4 w-4" aria-hidden="true" />,
          // Recurring parents are anchor docs that never go public —
          // the participant URL would 404. Disable rather than open
          // a broken tab. Children carry their own slug so the
          // default behaviour is fine for them.
          disabledReason: isParent
            ? "Le parent d'une série n'a pas de page publique — ouvrez une occurrence."
            : undefined,
          onClick: isParent ? undefined : () => window.open(`/events/${event.slug}`, "_blank"),
        },
      ]}
      tabs={tabs}
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

function SeriesTab({ parentEventId }: { parentEventId: string }) {
  // Phase 7+ B1 closure — children of a series anchor. Pulled via
  // the existing /v1/admin/events list with `parentEventId=...`,
  // capped at 100 (the platform-wide hard cap is 52 occurrences,
  // so 100 is safely above the ceiling and avoids paginating).
  const { data, isLoading, isError, error } = useAdminEvents({
    parentEventId,
    limit: 100,
    page: 1,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
        <Spinner />
      </div>
    );
  }

  if (isError) {
    return (
      <InlineErrorBanner
        severity="destructive"
        kicker="— Erreur"
        title="Impossible de charger les occurrences"
        description={error instanceof Error ? error.message : "Erreur inconnue"}
      />
    );
  }

  const children = data?.data ?? [];

  if (children.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
          <Repeat className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <div className="text-sm font-semibold text-foreground">Aucune occurrence</div>
          <div className="max-w-sm text-xs text-muted-foreground">
            Cette série n'a pas encore d'occurrences ou les enfants ont été supprimés.
          </div>
        </CardContent>
      </Card>
    );
  }

  // Sort by startDate ascending — chronological reading is what
  // operators expect when scanning a series ("when does the next
  // session run?").
  const sorted = [...children].sort((a, b) => {
    const aTs = new Date(a.startDate).getTime();
    const bTs = new Date(b.startDate).getTime();
    return aTs - bTs;
  });

  // Status counters for the section caption — gives at-a-glance
  // visibility into "is the whole series published or still draft".
  const draftCount = sorted.filter((c) => c.status === "draft").length;
  const publishedCount = sorted.filter((c) => c.status === "published").length;
  const cancelledCount = sorted.filter((c) => c.status === "cancelled").length;

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        {sorted.length} occurrence{sorted.length > 1 ? "s" : ""} ·{" "}
        {publishedCount > 0 && (
          <span className="text-teranga-green">{publishedCount} publiée{publishedCount > 1 ? "s" : ""}</span>
        )}
        {publishedCount > 0 && draftCount > 0 && " · "}
        {draftCount > 0 && (
          <span>{draftCount} brouillon{draftCount > 1 ? "s" : ""}</span>
        )}
        {cancelledCount > 0 && (
          <>
            {" · "}
            <span className="text-red-600">
              {cancelledCount} annulée{cancelledCount > 1 ? "s" : ""}
            </span>
          </>
        )}
      </div>
      <div className="divide-y divide-border rounded-xl border border-border">
        {sorted.map((child, idx) => (
          <Link
            key={child.id}
            href={`/admin/events/${encodeURIComponent(child.id)}`}
            className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-muted/50"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teranga-gold/10 text-[11px] font-semibold text-teranga-gold">
                {(child.occurrenceIndex ?? idx) + 1}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{child.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {fmtDate(child.startDate)}
                  {child.registeredCount !== undefined &&
                    ` · ${child.registeredCount} inscrit${child.registeredCount > 1 ? "s" : ""}`}
                </div>
              </div>
            </div>
            <Badge variant={statusVariant(child.status)} className="text-[10px]">
              {child.status}
            </Badge>
          </Link>
        ))}
      </div>
    </div>
  );
}

function WaitlistTab({ eventId }: { eventId: string }) {
  // Phase 7+ B2 closure — waitlist health snapshot. Four counts +
  // one timestamp, parallel-fetched server-side. Surface ALWAYS
  // renders the four cards (even when empty) so the absence of a
  // signal is visible — "0 promotion failure" is itself useful info.
  const { data, isLoading, isError, error } = useAdminEventWaitlistHealth(eventId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
        <Spinner />
      </div>
    );
  }

  if (isError) {
    return (
      <InlineErrorBanner
        severity="destructive"
        kicker="— Erreur"
        title="Impossible de charger la santé de la liste d'attente"
        description={error instanceof Error ? error.message : "Erreur inconnue"}
      />
    );
  }

  const health = data?.data;
  if (!health) return null;

  const lastPromoted = health.lastPromotedAt ? fmtDate(health.lastPromotedAt) : "—";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <HealthCard
          icon={<Hourglass className="h-5 w-5" aria-hidden="true" />}
          label="En attente"
          value={health.waitlistedCount}
          tone="info"
        />
        <HealthCard
          icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
          label="Promus (30j)"
          value={health.promotedCount30d}
          tone="success"
        />
        <HealthCard
          icon={<XCircle className="h-5 w-5" aria-hidden="true" />}
          label="Échecs (30j)"
          value={health.failureCount30d}
          tone={health.failureCount30d > 0 ? "danger" : "muted"}
        />
        <Card>
          <CardContent className="space-y-1 p-4 text-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Dernière promotion
            </div>
            <div className="text-sm font-medium text-foreground">{lastPromoted}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <DeepLinkCard
          icon={<CheckCircle2 className="h-8 w-8" aria-hidden="true" />}
          title="Historique des promotions"
          description="Audit des entrées promues (single + bulk) sur cet événement."
          href={`/admin/audit?action=waitlist.promoted&resourceId=${encodeURIComponent(eventId)}`}
          label="Voir l'audit →"
        />
        <DeepLinkCard
          icon={<XCircle className="h-8 w-8" aria-hidden="true" />}
          title="Tentatives en échec"
          description="Promotions ayant épuisé les retries — investiguer la cause."
          href={`/admin/audit?action=waitlist.promotion_failed&resourceId=${encodeURIComponent(eventId)}`}
          label="Voir les échecs →"
        />
      </div>
    </div>
  );
}

function HealthCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "info" | "success" | "danger" | "muted";
}) {
  const toneClass =
    tone === "success"
      ? "text-teranga-green"
      : tone === "danger"
        ? "text-red-600"
        : tone === "info"
          ? "text-teranga-gold"
          : "text-muted-foreground";
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          <span className={toneClass}>{icon}</span>
        </div>
        <div className={`text-2xl font-semibold ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
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
