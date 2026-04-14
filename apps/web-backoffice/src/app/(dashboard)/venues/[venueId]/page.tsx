"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  Badge,
  Button,
  Skeleton,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  QueryError,
  DataTable,
  type DataTableColumn,
} from "@teranga/shared-ui";
import { MapPin, Calendar, Users, Globe, Save, ChevronLeft, ChevronRight } from "lucide-react";
import { useVenue, useVenueEvents, useUpdateVenue } from "@/hooks/use-venues";
import { cn } from "@/lib/utils";

// ─── Constants ──────────────────────────────────────────────────────────────

const VENUE_TYPE_LABELS: Record<string, string> = {
  hotel: "H\u00f4tel",
  conference_center: "Centre de conf\u00e9rences",
  cultural_space: "Espace culturel",
  coworking: "Coworking",
  restaurant: "Restaurant",
  outdoor: "Plein air",
  university: "Universit\u00e9",
  sports: "Sports",
  other: "Autre",
};

const STATUS_STYLES: Record<
  string,
  {
    variant: "default" | "secondary" | "destructive" | "success" | "warning" | "outline";
    label: string;
  }
> = {
  pending: { variant: "warning", label: "En attente d'approbation" },
  approved: { variant: "success", label: "Approuv\u00e9" },
  suspended: { variant: "destructive", label: "Suspendu" },
  archived: { variant: "outline", label: "Archiv\u00e9" },
};

const TABS = [
  { id: "info", label: "Informations" },
  { id: "events", label: "\u00c9v\u00e9nements" },
  { id: "analytics", label: "Analytiques" },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ─── Page ───────────────────────────────────────────────────────────────────

export default function VenueDetailPage() {
  const { venueId } = useParams<{ venueId: string }>();
  const { data: venueData, isLoading, isError, refetch } = useVenue(venueId);
  const updateVenue = useUpdateVenue();
  const [activeTab, setActiveTab] = useState<TabId>("info");

  const venue = venueData?.data;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !venue) {
    return <QueryError message="Lieu introuvable ou erreur de chargement." onRetry={refetch} />;
  }

  const status = STATUS_STYLES[venue.status] ?? STATUS_STYLES.pending;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/venues">Mes Lieux</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{venue.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">{venue.name}</h1>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            {VENUE_TYPE_LABELS[venue.venueType] ?? venue.venueType}
            {venue.address?.city && ` \u2014 ${venue.address.city}, ${venue.address.country}`}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "info" && <InfoTab venue={venue} onUpdate={updateVenue} />}
      {activeTab === "events" && <EventsTab venueId={venueId} />}
      {activeTab === "analytics" && <AnalyticsTab venue={venue} />}
    </div>
  );
}

// ─── Info Tab ───────────────────────────────────────────────────────────────

function InfoTab({ venue, onUpdate }: { venue: any; onUpdate: any }) {
  const [name, setName] = useState(venue.name ?? "");
  const [description, setDescription] = useState(venue.description ?? "");
  const [street, setStreet] = useState(venue.address?.street ?? "");
  const [city, setCity] = useState(venue.address?.city ?? "");
  const [contactName, setContactName] = useState(venue.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(venue.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(venue.contactPhone ?? "");
  const [website, setWebsite] = useState(venue.website ?? "");
  const [amenities, setAmenities] = useState((venue.amenities ?? []).join(", "));

  const handleSave = async () => {
    try {
      await onUpdate.mutateAsync({
        venueId: venue.id,
        dto: {
          name: name || undefined,
          description: description || undefined,
          address: { street, city, country: venue.address?.country ?? "SN" },
          contactName: contactName || undefined,
          contactEmail: contactEmail || undefined,
          contactPhone: contactPhone || undefined,
          website: website || undefined,
          amenities: amenities
            .split(",")
            .map((a: string) => a.trim())
            .filter(Boolean),
        },
      });
      toast.success("Lieu mis \u00e0 jour");
    } catch {
      toast.error("Erreur lors de la mise \u00e0 jour");
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* General info */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h3 className="font-semibold text-foreground">Informations g\u00e9n\u00e9rales</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Nom</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Adresse</label>
                <input
                  type="text"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Ville</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                \u00c9quipements
              </label>
              <input
                type="text"
                value={amenities}
                onChange={(e) => setAmenities(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="wifi, parking, climatisation (s\u00e9par\u00e9s par des virgules)"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Site web</label>
              <input
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="https://..."
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Contact */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h3 className="font-semibold text-foreground">Contact</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Nom du contact
              </label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Email</label>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                T\u00e9l\u00e9phone
              </label>
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="+221 7X XXX XX XX"
              />
            </div>
          </div>

          {/* Quick stats */}
          <div className="mt-6 pt-4 border-t border-border">
            <h4 className="text-sm font-medium text-foreground mb-3">R\u00e9sum\u00e9</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar size={14} />
                <span>
                  {venue.eventCount ?? 0} \u00e9v\u00e9nement
                  {(venue.eventCount ?? 0) !== 1 ? "s" : ""}
                </span>
              </div>
              {venue.capacity?.max && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users size={14} />
                  <span>Capacit\u00e9 max: {venue.capacity.max}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin size={14} />
                <span>
                  {venue.address?.city ?? "N/A"}, {venue.address?.country ?? "SN"}
                </span>
              </div>
              {venue.website && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Globe size={14} />
                  <a
                    href={venue.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline truncate"
                  >
                    {venue.website.replace(/^https?:\/\//, "")}
                  </a>
                </div>
              )}
            </div>
          </div>

          <Button onClick={handleSave} disabled={onUpdate.isPending} className="w-full mt-4">
            <Save size={16} className="mr-1.5" />
            {onUpdate.isPending ? "Enregistrement..." : "Enregistrer"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Events Tab ─────────────────────────────────────────────────────────────

function EventsTab({ venueId }: { venueId: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useVenueEvents(venueId, { page, limit: 10 });

  const events = data?.data ?? [];
  const meta = data?.meta;

  return (
    <Card>
      <CardContent className="p-6">
        <h3 className="font-semibold text-foreground mb-4">\u00c9v\u00e9nements dans ce lieu</h3>

        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}

        {!isLoading && (
          <DataTable<Record<string, unknown>>
            aria-label="\u00c9v\u00e9nements du lieu"
            emptyMessage="Aucun \u00e9v\u00e9nement programm\u00e9 dans ce lieu"
            responsiveCards
            data={events as Record<string, unknown>[]}
            columns={
              [
                {
                  key: "title",
                  header: "\u00c9v\u00e9nement",
                  primary: true,
                  render: (event) => (
                    <Link
                      href={`/events/${event.id as string}`}
                      className="text-foreground hover:underline font-medium"
                    >
                      {event.title as string}
                    </Link>
                  ),
                },
                {
                  key: "startDate",
                  header: "Date",
                  render: (event) => (
                    <span className="text-muted-foreground">
                      {event.startDate
                        ? new Date(event.startDate as string).toLocaleDateString("fr-FR", {
                            dateStyle: "medium",
                          })
                        : "\u2014"}
                    </span>
                  ),
                },
                {
                  key: "status",
                  header: "Statut",
                  render: (event) => (
                    <Badge
                      variant={event.status === "published" ? "success" : "secondary"}
                      className="text-[10px]"
                    >
                      {event.status as string}
                    </Badge>
                  ),
                },
                {
                  key: "registered",
                  header: "Inscrits",
                  hideOnMobile: true,
                  render: (event) => (
                    <span className="text-muted-foreground">
                      {(event.registeredCount as number) ?? 0}
                    </span>
                  ),
                },
              ] as DataTableColumn<Record<string, unknown>>[]
            }
          />
        )}

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
            <span className="text-xs text-muted-foreground">
              Page {meta.page} sur {meta.totalPages} ({meta.total} total)
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft size={14} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= meta.totalPages}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Analytics Tab ──────────────────────────────────────────────────────────

function AnalyticsTab({ venue }: { venue: any }) {
  const stats = [
    {
      label: "\u00c9v\u00e9nements h\u00e9berg\u00e9s",
      value: venue.eventCount ?? 0,
      icon: Calendar,
    },
    { label: "Capacit\u00e9 max", value: venue.capacity?.max ?? "\u2014", icon: Users },
    {
      label: "Note",
      value: venue.rating ? `${venue.rating}/5` : "Pas encore not\u00e9",
      icon: MapPin,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 rounded-lg bg-primary/10">
              <stat.icon size={20} className="text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
