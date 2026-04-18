"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  Button,
  Skeleton,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  QueryError,
  SectionHeader,
  StatusPill,
  EmptyStateEditorial,
  type StatusPillTone,
} from "@teranga/shared-ui";
import { MapPin, Plus, Calendar, Users, ExternalLink } from "lucide-react";
import { useMyVenues, useCreateVenue } from "@/hooks/use-venues";
import { useTranslations } from "next-intl";

// ─── Constants ──────────────────────────────────────────────────────────────

const VENUE_TYPE_LABELS: Record<string, string> = {
  hotel: "Hotel",
  conference_center: "Centre de conf.",
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
    tone: StatusPillTone;
    label: string;
  }
> = {
  pending: { tone: "warning", label: "En attente" },
  approved: { tone: "success", label: "Approuv\u00e9" },
  suspended: { tone: "danger", label: "Suspendu" },
  archived: { tone: "neutral", label: "Archiv\u00e9" },
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function VenuesPage() {
  const tCommon = useTranslations("common"); void tCommon;
  const { data, isLoading, isError, refetch } = useMyVenues();
  const createVenue = useCreateVenue();
  const [showCreate, setShowCreate] = useState(false);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("conference_center");
  const [formCity, setFormCity] = useState("Dakar");
  const [formStreet, setFormStreet] = useState("");
  const [formContact, setFormContact] = useState("");
  const [formEmail, setFormEmail] = useState("");

  const venues = data?.data ?? [];

  const handleCreate = async () => {
    if (!formName.trim() || !formEmail.trim() || !formContact.trim()) return;
    try {
      await createVenue.mutateAsync({
        name: formName.trim(),
        venueType: formType as any,
        address: { street: formStreet, city: formCity, country: "SN" },
        contactName: formContact,
        contactEmail: formEmail,
        amenities: [],
        photos: [],
      });
      setShowCreate(false);
      setFormName("");
      setFormStreet("");
      setFormContact("");
      setFormEmail("");
      toast.success("Lieu cr\u00e9\u00e9 avec succ\u00e8s");
    } catch {
      toast.error("Erreur lors de la cr\u00e9ation du lieu");
    }
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/dashboard">Tableau de bord</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Mes Lieux</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <SectionHeader
        kicker="— ESPACES"
        title="Mes Lieux"
        subtitle="G\u00e9rez vos espaces \u00e9v\u00e9nementiels et suivez leur activit\u00e9."
        size="hero"
        as="h1"
        action={
          <Button onClick={() => setShowCreate(!showCreate)} size="sm">
            <Plus size={16} className="mr-1.5" />
            Ajouter un lieu
          </Button>
        }
      />

      {/* Create form */}
      {showCreate && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <h3 className="font-semibold text-foreground">Nouveau lieu</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Nom *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Ex: CICAD - Centre de Dakar"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Type</label>
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {Object.entries(VENUE_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Adresse</label>
                <input
                  type="text"
                  value={formStreet}
                  onChange={(e) => setFormStreet(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Rue, quartier"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Ville</label>
                <input
                  type="text"
                  value={formCity}
                  onChange={(e) => setFormCity(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Contact *</label>
                <input
                  type="text"
                  value={formContact}
                  onChange={(e) => setFormContact(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="Nom du contact"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Email *</label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="contact@monlieu.sn"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleCreate} disabled={createVenue.isPending} size="sm">
                {createVenue.isPending ? "Cr\u00e9ation..." : "Cr\u00e9er"}
              </Button>
              <Button variant="outline" onClick={() => setShowCreate(false)} size="sm">
                Annuler
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-32 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Error */}
      {isError && <QueryError onRetry={refetch} />}

      {/* Empty */}
      {!isLoading && !isError && venues.length === 0 && (
        <EmptyStateEditorial
          icon={MapPin}
          kicker="— AUCUN LIEU"
          title="D\u00e9marrez votre catalogue"
          description="Ajoutez votre premier espace \u00e9v\u00e9nementiel pour commencer \u00e0 organiser des \u00e9v\u00e9nements."
          action={
            <Button onClick={() => setShowCreate(true)} size="sm">
              <Plus size={16} className="mr-1.5" />
              Ajouter un lieu
            </Button>
          }
        />
      )}

      {/* Venue cards */}
      {!isLoading && venues.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {venues.map((venue: any) => {
            const status = STATUS_STYLES[venue.status] ?? STATUS_STYLES.pending;
            return (
              <Link key={venue.id} href={`/venues/${venue.id}`}>
                <Card className="hover:border-primary/30 transition-colors cursor-pointer h-full">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground truncate">{venue.name}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {VENUE_TYPE_LABELS[venue.venueType] ?? venue.venueType}
                          {venue.address?.city && ` \u2014 ${venue.address.city}`}
                        </p>
                      </div>
                      <StatusPill
                        tone={status.tone}
                        label={status.label}
                        className="ml-2 shrink-0"
                      />
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground mt-4">
                      <span className="flex items-center gap-1">
                        <Calendar size={13} />
                        {venue.eventCount ?? 0} \u00e9v\u00e9nement
                        {(venue.eventCount ?? 0) !== 1 ? "s" : ""}
                      </span>
                      {venue.capacity?.max && (
                        <span className="flex items-center gap-1">
                          <Users size={13} />
                          {venue.capacity.max} places
                        </span>
                      )}
                      {venue.website && (
                        <span className="flex items-center gap-1">
                          <ExternalLink size={13} />
                          Site web
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
