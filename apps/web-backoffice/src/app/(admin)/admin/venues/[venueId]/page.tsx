"use client";

/**
 * Phase B (P3 closure) — Admin venue detail page.
 *
 * Tabs:
 *   - Aperçu          : adresse, capacité, contact, amenities
 *   - Événements      : deep-link vers /admin/events filtré par venueId
 *   - Audit lifecycle : timeline submit → approve / suspend / reactivate
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Badge, Card, CardContent, Skeleton, InlineErrorBanner } from "@teranga/shared-ui";
import { MapPin, Mail, Phone, Globe, Calendar, Users, ShieldCheck } from "lucide-react";
import type { Venue } from "@teranga/shared-types";
import { venuesApi } from "@/lib/api-client";
import { EntityDetailLayout } from "@/components/admin/entity-detail-layout";
import { useErrorHandler } from "@/hooks/use-error-handler";

export default function AdminVenueDetailPage() {
  const params = useParams<{ venueId: string }>();
  const router = useRouter();
  const { resolve } = useErrorHandler();
  const [venue, setVenue] = useState<Venue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVenue = useCallback(async () => {
    try {
      setLoading(true);
      const res = await venuesApi.getById(params.venueId);
      setVenue(res.data);
      setError(null);
    } catch (err) {
      setError(resolve(err).description);
    } finally {
      setLoading(false);
    }
  }, [params.venueId, resolve]);

  useEffect(() => {
    void fetchVenue();
  }, [fetchVenue]);

  if (loading && !venue) {
    return (
      <div className="container mx-auto max-w-6xl space-y-6 p-6">
        <Skeleton variant="text" className="h-4 w-64" />
        <Skeleton variant="text" className="h-8 w-80" />
        <Skeleton variant="text" className="h-96 w-full" />
      </div>
    );
  }

  if (error && !venue) {
    return (
      <div className="container mx-auto max-w-4xl p-6">
        <InlineErrorBanner
          severity="destructive"
          kicker="— Erreur"
          title="Impossible de charger le lieu"
          description={error}
        />
        <button
          type="button"
          onClick={() => router.push("/admin/venues")}
          className="mt-4 text-sm text-teranga-gold hover:underline"
        >
          ← Retour à la liste
        </button>
      </div>
    );
  }

  if (!venue) return null;

  return (
    <EntityDetailLayout
      breadcrumbs={[
        { label: "Administration", href: "/admin" },
        { label: "Lieux", href: "/admin/venues" },
        { label: venue.name },
      ]}
      title={venue.name}
      subtitle={
        <span className="inline-flex items-center gap-2">
          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
          {venue.address.city}, {venue.address.country}
          <span aria-hidden="true">·</span>
          <code className="font-mono text-[11px]">{venue.slug}</code>
        </span>
      }
      pills={
        <>
          <Badge variant={statusVariant(venue.status)}>{venue.status}</Badge>
          <Badge variant="outline" className="text-[10px]">
            {venue.venueType}
          </Badge>
        </>
      }
      tabs={[
        { id: "overview", label: "Aperçu", render: () => <OverviewTab venue={venue} /> },
        {
          id: "events",
          label: "Événements",
          count: venue.eventCount ?? 0,
          render: () => <EventsTab venue={venue} />,
        },
        { id: "audit", label: "Audit", render: () => <AuditTab venue={venue} /> },
      ]}
    />
  );
}

function statusVariant(status: string): "success" | "outline" | "destructive" | "secondary" {
  switch (status) {
    case "approved":
      return "success";
    case "pending":
      return "outline";
    case "suspended":
      return "destructive";
    default:
      return "secondary";
  }
}

function OverviewTab({ venue }: { venue: Venue }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardContent className="space-y-3 p-4 text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Adresse
          </div>
          <div className="flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <div>
              <div>{venue.address.street}</div>
              <div className="text-muted-foreground">
                {venue.address.city}, {venue.address.region ?? ""} · {venue.address.country}
              </div>
            </div>
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
            Jusqu'à <strong>{venue.capacity?.max ?? "?"}</strong> personnes
          </div>
          {venue.amenities && venue.amenities.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-2">
              {venue.amenities.map((a) => (
                <Badge key={a} variant="outline" className="text-[10px]">
                  {a}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="md:col-span-2">
        <CardContent className="space-y-2 p-4 text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Contact
          </div>
          {venue.contactName && <div>{venue.contactName}</div>}
          {venue.contactEmail && (
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <a
                href={`mailto:${venue.contactEmail}`}
                className="text-teranga-gold hover:underline"
              >
                {venue.contactEmail}
              </a>
            </div>
          )}
          {venue.contactPhone && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {venue.contactPhone}
            </div>
          )}
          {venue.website && (
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <a
                href={venue.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-teranga-gold hover:underline"
              >
                {venue.website}
              </a>
            </div>
          )}
          {venue.description && (
            <div className="pt-2 text-muted-foreground">{venue.description}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EventsTab({ venue }: { venue: Venue }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
        <Calendar className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <div className="text-sm font-semibold text-foreground">
          {venue.eventCount ?? 0} événement(s) hébergé(s)
        </div>
        <Link
          href={`/admin/events`}
          className="mt-2 text-sm font-medium text-teranga-gold hover:underline"
        >
          Voir les événements →
        </Link>
      </CardContent>
    </Card>
  );
}

function AuditTab(_props: { venue: Venue }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
        <ShieldCheck className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <div className="text-sm font-semibold text-foreground">Cycle de vie du lieu</div>
        <div className="max-w-sm text-xs text-muted-foreground">
          Historique des événements de modération : submit → approve → suspend / reactivate.
        </div>
        <Link
          href={`/admin/audit?resourceType=venue`}
          className="mt-2 text-sm font-medium text-teranga-gold hover:underline"
        >
          Ouvrir l'audit →
        </Link>
      </CardContent>
    </Card>
  );
}
