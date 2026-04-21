"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Calendar,
  MapPin,
  Tag,
  Users,
  Mic2,
  LayoutList,
  ArrowLeft,
  AlertTriangle,
  Search,
} from "lucide-react";
import {
  Button,
  Badge,
  formatDate,
  EmptyStateEditorial,
  SectionHeader,
  Skeleton,
} from "@teranga/shared-ui";

import { eventsApi, speakersApi, sessionsApi } from "@/lib/api-client";
import type { Event } from "@teranga/shared-types";

interface ComparisonRow {
  label: string;
  icon: React.ReactNode;
  render: (event: Event) => React.ReactNode;
}

function getPriceRange(event: Event): string {
  if (event.ticketTypes.length === 0) return "Gratuit";
  const prices = event.ticketTypes.map((t) => t.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === 0 && max === 0) return "Gratuit";
  const fmt = (n: number) =>
    Intl.NumberFormat("fr-SN", {
      style: "currency",
      currency: "XOF",
      maximumFractionDigits: 0,
    }).format(n);
  if (min === max) return fmt(min);
  return `${fmt(min)} — ${fmt(max)}`;
}

function getCapacityLabel(event: Event): string {
  const total = event.maxAttendees;
  const registered = event.registeredCount;
  if (!total) return `${registered} inscrit${registered > 1 ? "s" : ""}`;
  const available = Math.max(0, total - registered);
  return `${available} / ${total} places`;
}

const CATEGORY_LABELS: Record<string, string> = {
  conference: "Conference",
  workshop: "Atelier",
  concert: "Concert",
  festival: "Festival",
  networking: "Networking",
  sport: "Sport",
  exhibition: "Exposition",
  ceremony: "Ceremonie",
  training: "Formation",
  other: "Autre",
};

function CompareContent() {
  const searchParams = useSearchParams();
  const idsParam = searchParams.get("ids") ?? "";
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const [events, setEvents] = useState<Event[]>([]);
  const [speakerCounts, setSpeakerCounts] = useState<Record<string, number>>({});
  const [sessionCounts, setSessionCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ids.length === 0) return;
    if (ids.length > 3) {
      setError("Vous pouvez comparer 3 evenements maximum.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all(ids.map((id) => eventsApi.getById(id)))
      .then((results) => {
        if (!cancelled) {
          const evts = results.map((r) => r.data);
          setEvents(evts);

          // Fetch speaker and session counts in parallel (non-blocking)
          Promise.all(
            evts.map((evt) =>
              speakersApi
                .list(evt.id)
                .then((r) => [evt.id, r.meta?.total ?? r.data?.length ?? 0] as const)
                .catch(() => [evt.id, 0] as const),
            ),
          ).then((counts) => {
            if (!cancelled) setSpeakerCounts(Object.fromEntries(counts));
          });

          Promise.all(
            evts.map((evt) =>
              sessionsApi
                .list(evt.id)
                .then((r) => [evt.id, r.meta?.total ?? r.data?.length ?? 0] as const)
                .catch(() => [evt.id, 0] as const),
            ),
          ).then((counts) => {
            if (!cancelled) setSessionCounts(Object.fromEntries(counts));
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Impossible de charger les evenements. Verifiez les identifiants.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [idsParam]);

  const rows: ComparisonRow[] = [
    {
      label: "Date",
      icon: <Calendar className="h-4 w-4" />,
      render: (e) => (
        <span>
          {formatDate(e.startDate)}
          {e.endDate !== e.startDate && (
            <span className="text-muted-foreground"> — {formatDate(e.endDate)}</span>
          )}
        </span>
      ),
    },
    {
      label: "Lieu",
      icon: <MapPin className="h-4 w-4" />,
      render: (e) => (
        <span>
          {e.location?.name && <span className="block">{e.location.name}</span>}
          {e.location?.city && (
            <span className="text-sm text-muted-foreground">{e.location.city}</span>
          )}
        </span>
      ),
    },
    {
      label: "Categorie",
      icon: <Tag className="h-4 w-4" />,
      render: (e) => <Badge variant="secondary">{CATEGORY_LABELS[e.category] ?? e.category}</Badge>,
    },
    {
      label: "Prix",
      icon: <Tag className="h-4 w-4" />,
      render: (e) => <span className="font-semibold text-teranga-gold">{getPriceRange(e)}</span>,
    },
    {
      label: "Capacite",
      icon: <Users className="h-4 w-4" />,
      render: (e) => <span>{getCapacityLabel(e)}</span>,
    },
    {
      label: "Intervenants",
      icon: <Mic2 className="h-4 w-4" />,
      render: (e) => {
        const count = speakerCounts[e.id];
        if (count === undefined) return <span className="text-muted-foreground">...</span>;
        if (count === 0) return <span className="text-muted-foreground">—</span>;
        return (
          <span>
            {count} intervenant{count > 1 ? "s" : ""}
          </span>
        );
      },
    },
    {
      label: "Sessions",
      icon: <LayoutList className="h-4 w-4" />,
      render: (e) => {
        const count = sessionCounts[e.id];
        if (count === undefined) return <span className="text-muted-foreground">...</span>;
        if (count === 0) return <span className="text-muted-foreground">—</span>;
        return (
          <span>
            {count} session{count > 1 ? "s" : ""}
          </span>
        );
      },
    },
  ];

  // Empty state: no IDs
  if (ids.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <EmptyStateEditorial
          icon={Search}
          kicker="— COMPARAISON"
          title="Comparer des événements"
          description="Sélectionnez des événements à comparer depuis la liste des événements."
          action={
            <Link href="/events">
              <Button variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Parcourir les événements
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <EmptyStateEditorial
          icon={AlertTriangle}
          kicker="— ERREUR"
          title="Erreur"
          description={error}
          action={
            <Link href="/events">
              <Button variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Retour aux événements
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <Skeleton variant="text" className="h-8 w-64" />
          <Skeleton variant="text" className="mt-2 h-5 w-48" />
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {ids.map((id) => (
            <div key={id} className="space-y-4">
              <Skeleton variant="rectangle" className="aspect-[16/10] h-auto w-full rounded-card" />
              <Skeleton variant="text" className="h-6 w-3/4" />
              <Skeleton variant="text" className="h-4 w-1/2" />
              <Skeleton variant="text" className="h-4 w-2/3" />
              <Skeleton variant="text" className="h-4 w-1/2" />
              <Skeleton variant="text" className="h-4 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="space-y-4">
        <Link
          href="/events"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour aux événements
        </Link>
        <SectionHeader
          kicker="— COMPARAISON"
          title="Comparaison d'événements"
          size="hero"
          as="h1"
          subtitle={`${events.length} événement${events.length > 1 ? "s" : ""} comparé${events.length > 1 ? "s" : ""}`}
        />
      </div>

      {/* Desktop: table layout */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full border-collapse">
          {/* Event headers */}
          <thead>
            <tr>
              <th className="w-40 p-3 text-left text-sm font-medium text-muted-foreground align-bottom" />
              {events.map((event) => (
                <th key={event.id} className="p-3 text-left align-bottom">
                  <div className="space-y-3">
                    <div className="relative aspect-[16/9] overflow-hidden rounded-lg bg-muted">
                      {event.coverImageURL ? (
                        <Image
                          src={event.coverImageURL}
                          alt={event.title}
                          fill
                          className="object-cover"
                          sizes="(max-width: 1024px) 50vw, 33vw"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-gradient-to-br from-teranga-navy to-teranga-navy/80">
                          <span className="text-3xl font-bold text-teranga-gold">
                            {event.title.charAt(0)}
                          </span>
                        </div>
                      )}
                    </div>
                    <h2 className="font-serif-display text-[20px] font-semibold leading-[1.15] tracking-[-0.015em] line-clamp-2">
                      {event.title}
                    </h2>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.label} className={i % 2 === 0 ? "bg-muted/30" : ""}>
                <td className="p-3 text-sm font-medium text-muted-foreground">
                  <span className="flex items-center gap-2">
                    {row.icon}
                    {row.label}
                  </span>
                </td>
                {events.map((event) => (
                  <td key={event.id} className="p-3 text-sm">
                    {row.render(event)}
                  </td>
                ))}
              </tr>
            ))}
            {/* Action row */}
            <tr>
              <td className="p-3" />
              {events.map((event) => (
                <td key={event.id} className="p-3">
                  <Link href={`/events/${event.slug}`}>
                    <Button className="w-full">Voir l&apos;evenement</Button>
                  </Link>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards */}
      <div className="md:hidden space-y-6">
        {events.map((event) => (
          <div key={event.id} className="overflow-hidden rounded-lg border bg-card shadow-sm">
            {/* Card header image */}
            <div className="relative aspect-[16/9] overflow-hidden bg-muted">
              {event.coverImageURL ? (
                <Image
                  src={event.coverImageURL}
                  alt={event.title}
                  fill
                  className="object-cover"
                  sizes="100vw"
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-gradient-to-br from-teranga-navy to-teranga-navy/80">
                  <span className="text-3xl font-bold text-teranga-gold">
                    {event.title.charAt(0)}
                  </span>
                </div>
              )}
            </div>

            <div className="p-4">
              <h2 className="font-serif-display text-[20px] font-semibold leading-[1.15] tracking-[-0.015em]">
                {event.title}
              </h2>

              <div className="mt-4 space-y-3">
                {rows.map((row) => (
                  <div key={row.label} className="flex items-start gap-3">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground min-w-[110px]">
                      {row.icon}
                      {row.label}
                    </span>
                    <span className="text-sm">{row.render(event)}</span>
                  </div>
                ))}
              </div>

              <Link href={`/events/${event.slug}`} className="mt-4 block">
                <Button className="w-full">Voir l&apos;evenement</Button>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CompareEventsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <Skeleton variant="text" className="h-8 w-64" />
          <Skeleton variant="text" className="mt-2 h-5 w-48" />
        </div>
      }
    >
      <CompareContent />
    </Suspense>
  );
}
