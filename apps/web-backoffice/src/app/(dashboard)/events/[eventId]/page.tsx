"use client";

import { useState, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ConfirmDialog,
  getErrorMessage,
  getStatusVariant,
  Badge,
  EmptyState,
  Skeleton,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Input,
  Select,
  Textarea,
  Button,
  QueryError,
} from "@teranga/shared-ui";
import { PlanGate } from "@/components/plan/PlanGate";
import { CsvExportButton, type CsvColumn } from "@/components/csv-export-button";
import {
  useEvent,
  useUpdateEvent,
  usePublishEvent,
  useUnpublishEvent,
  useCancelEvent,
  useAddTicketType,
  useRemoveTicketType,
} from "@/hooks/use-events";
import {
  useEventRegistrations,
  useApproveRegistration,
  useCancelRegistration,
  usePromoteRegistration,
} from "@/hooks/use-registrations";
import { formatDate, formatCurrency } from "@/lib/utils";
import {
  Globe,
  GlobeLock,
  Loader2,
  Plus,
  Trash2,
  CheckCircle,
  XCircle,
  Users,
  Ticket,
  Info,
  ChevronLeft,
  ChevronRight,
  ScanLine,
  MapPin,
  Copy,
  Pencil,
  Save,
  X,
  ImagePlus,
} from "lucide-react";
import Link from "next/link";
import { useAddAccessZone, useRemoveAccessZone } from "@/hooks/use-access-zones";
import { useSessions, useCreateSession, useDeleteSession } from "@/hooks/use-sessions";
import { useEventPayments, usePaymentSummary, useRefundPayment } from "@/hooks/use-payments";
import { useFeedPosts, useCreateFeedPost, useDeleteFeedPost, useTogglePin } from "@/hooks/use-feed";
import { useEventSpeakers, useCreateSpeaker, useDeleteSpeaker } from "@/hooks/use-speakers";
import { useEventSponsors, useCreateSponsor, useDeleteSponsor } from "@/hooks/use-sponsors";
import {
  useEventPromoCodes,
  useCreatePromoCode,
  useDeactivatePromoCode,
} from "@/hooks/use-promo-codes";
import { eventsApi, uploadsApi } from "@/lib/api-client";
import type {
  Event,
  CreateTicketTypeDto,
  CreateAccessZoneDto,
  CreateSessionDto,
  Payment,
  PaymentSummary,
  SpeakerProfile,
  SponsorProfile,
  SponsorTier,
  UpdateEventDto,
} from "@teranga/shared-types";
import {
  Calendar,
  MessageSquare,
  Clock,
  Mic,
  UserRound,
  Building,
  ArrowUpCircle,
} from "lucide-react";

const TABS = [
  "Infos",
  "Billets",
  "Inscriptions",
  "Paiements",
  "Sessions",
  "Feed",
  "Zones",
  "Intervenants",
  "Sponsors",
  "Promos",
] as const;
type Tab = (typeof TABS)[number];

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  published: "Publié",
  cancelled: "Annulé",
  archived: "Archivé",
  completed: "Terminé",
};

const REG_STATUS: Record<string, string> = {
  confirmed: "Confirmé",
  pending: "En attente",
  pending_payment: "Paiement en attente",
  waitlisted: "Liste d'attente",
  cancelled: "Annulé",
  payment_failed: "Paiement échoué",
  checked_in: "Entré",
};

const CSV_COLUMNS: CsvColumn[] = [
  { key: "participantName", header: "Nom" },
  { key: "participantEmail", header: "Email" },
  { key: "status", header: "Statut" },
  { key: "createdAt", header: "Date d'inscription" },
  { key: "ticketTypeName", header: "Type de billet" },
];

export default function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "Infos";
  const setTab = useCallback(
    (t: Tab) => {
      router.replace(`/events/${eventId}?tab=${t}`, { scroll: false });
    },
    [router, eventId],
  );

  const { data, isLoading, isError, refetch } = useEvent(eventId);
  const event = data?.data;

  if (isLoading) {
    return (
      <div>
        <Skeleton variant="text" className="h-4 w-24 mb-4" />
        <div className="flex items-start justify-between mb-6">
          <div>
            <Skeleton variant="text" className="h-8 w-64 mb-2" />
            <Skeleton variant="text" className="h-4 w-40" />
          </div>
          <Skeleton variant="rectangle" className="h-10 w-32" />
        </div>
        <div className="flex gap-1 border-b border-border mb-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} variant="text" className="h-10 w-20" />
          ))}
        </div>
        <div className="space-y-4">
          <Skeleton variant="rectangle" className="h-40 w-full" />
          <Skeleton variant="rectangle" className="h-40 w-full" />
        </div>
      </div>
    );
  }

  if (isError || !event) {
    return (
      <QueryError message="Événement introuvable ou erreur de chargement." onRetry={refetch} />
    );
  }

  return (
    <div>
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/">Tableau de bord</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/events">Événements</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{event.title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-foreground">{event.title}</h1>
            <StatusBadge status={event.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {formatDate(event.startDate)} — {event.location?.city ?? "En ligne"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {event.status === "published" && (
            <Link
              href={`/events/${eventId}/checkin`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium"
            >
              <ScanLine className="h-4 w-4" />
              Check-in
            </Link>
          )}
          <EventActions event={event} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto scrollbar-none">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-muted-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Infos" && <InfoTab event={event} />}
      {tab === "Billets" && <TicketsTab event={event} />}
      {tab === "Inscriptions" && <RegistrationsTab eventId={eventId} />}
      {tab === "Paiements" && <PaymentsTab eventId={eventId} />}
      {tab === "Sessions" && <SessionsTab eventId={eventId} eventStatus={event.status} />}
      {tab === "Feed" && <FeedTab eventId={eventId} />}
      {tab === "Zones" && <AccessZonesTab event={event} />}
      {tab === "Intervenants" && (
        <PlanGate feature="speakerPortal" fallback="blur">
          <SpeakersTab eventId={eventId} />
        </PlanGate>
      )}
      {tab === "Sponsors" && (
        <PlanGate feature="sponsorPortal" fallback="blur">
          <SponsorsTab eventId={eventId} />
        </PlanGate>
      )}
      {tab === "Promos" && (
        <PlanGate feature="promoCodes" fallback="blur">
          <PromosTab eventId={eventId} />
        </PlanGate>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={getStatusVariant(status)}>{STATUS_LABELS[status] ?? status}</Badge>;
}

function EventActions({ event }: { event: Event }) {
  const router = useRouter();
  const publish = usePublishEvent();
  const unpublish = useUnpublishEvent();
  const cancel = useCancelEvent();
  const [cloning, setCloning] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const handleClone = async () => {
    setCloning(true);
    try {
      const now = new Date();
      const newStart = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate(), 9, 0);
      const newEnd = new Date(
        newStart.getTime() +
          (new Date(event.endDate).getTime() - new Date(event.startDate).getTime()),
      );
      const result = await eventsApi.clone(event.id, {
        newStartDate: newStart.toISOString(),
        newEndDate: newEnd.toISOString(),
        copyTicketTypes: true,
        copyAccessZones: true,
      });
      toast.success("Événement dupliqué avec succès.");
      router.push(`/events/${result.data.id}`);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      const message = (err as { message?: string })?.message;
      toast.error(getErrorMessage(code, message));
    } finally {
      setCloning(false);
    }
  };

  return (
    <>
      <div className="flex gap-2">
        <button
          onClick={handleClone}
          disabled={cloning}
          className="inline-flex items-center gap-1.5 border border-border text-muted-foreground rounded-lg px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <Copy className="h-4 w-4" />
          {cloning ? "Duplication..." : "Dupliquer"}
        </button>
        {event.status === "draft" && (
          <button
            onClick={() => {
              publish.mutate(event.id, {
                onSuccess: () => toast.success("Événement publié."),
                onError: (err: unknown) => {
                  const code = (err as { code?: string })?.code;
                  const message = (err as { message?: string })?.message;
                  toast.error(getErrorMessage(code, message));
                },
              });
            }}
            disabled={publish.isPending}
            className="inline-flex items-center gap-1.5 bg-green-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            <Globe className="h-4 w-4" />
            {publish.isPending ? "Publication..." : "Publier"}
          </button>
        )}
        {event.status === "published" && (
          <button
            onClick={() => {
              unpublish.mutate(event.id, {
                onSuccess: () => toast.success("Événement dépublié."),
                onError: (err: unknown) => {
                  const code = (err as { code?: string })?.code;
                  const message = (err as { message?: string })?.message;
                  toast.error(getErrorMessage(code, message));
                },
              });
            }}
            disabled={unpublish.isPending}
            className="inline-flex items-center gap-1.5 bg-yellow-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-yellow-700 disabled:opacity-50"
          >
            <GlobeLock className="h-4 w-4" />
            {unpublish.isPending ? "..." : "D��publier"}
          </button>
        )}
        {(event.status === "draft" || event.status === "published") && (
          <button
            onClick={() => setShowCancelConfirm(true)}
            disabled={cancel.isPending}
            className="inline-flex items-center gap-1.5 border border-red-200 text-red-600 rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-50 disabled:opacity-50"
          >
            <XCircle className="h-4 w-4" />
            Annuler
          </button>
        )}
      </div>
      <ConfirmDialog
        open={showCancelConfirm}
        onConfirm={() => {
          cancel.mutate(event.id, {
            onSuccess: () => toast.success("Événement annulé."),
            onError: (err: unknown) => {
              const code = (err as { code?: string })?.code;
              const message = (err as { message?: string })?.message;
              toast.error(getErrorMessage(code, message));
            },
          });
          setShowCancelConfirm(false);
        }}
        onCancel={() => setShowCancelConfirm(false)}
        title="Annuler l'événement"
        description="Êtes-vous sûr(e) de vouloir annuler cet événement ? Les participants seront notifiés. Cette action est irréversible."
        confirmLabel="Oui, annuler"
        cancelLabel="Non, garder"
        variant="danger"
      />
    </>
  );
}

const CATEGORY_OPTIONS = [
  { value: "conference", label: "Conférence" },
  { value: "workshop", label: "Atelier" },
  { value: "concert", label: "Concert" },
  { value: "festival", label: "Festival" },
  { value: "networking", label: "Networking" },
  { value: "sport", label: "Sport" },
  { value: "exhibition", label: "Exposition" },
  { value: "ceremony", label: "Cérémonie" },
  { value: "training", label: "Formation" },
  { value: "other", label: "Autre" },
];

const FORMAT_OPTIONS = [
  { value: "in_person", label: "En présentiel" },
  { value: "online", label: "En ligne" },
  { value: "hybrid", label: "Hybride" },
];

function InfoTab({ event }: { event: Event }) {
  const [editing, setEditing] = useState(false);
  const updateEvent = useUpdateEvent(event.id);

  // Editable fields
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description);
  const [shortDescription, setShortDescription] = useState(event.shortDescription ?? "");
  const [category, setCategory] = useState<string>(event.category);
  const [format, setFormat] = useState<string>(event.format);
  const [startDate, setStartDate] = useState(event.startDate.slice(0, 16));
  const [endDate, setEndDate] = useState(event.endDate.slice(0, 16));
  const [maxAttendees, setMaxAttendees] = useState(
    event.maxAttendees ? String(event.maxAttendees) : "",
  );
  const [tags, setTags] = useState((event.tags ?? []).join(", "));
  const [locationName, setLocationName] = useState(event.location?.name ?? "");
  const [locationAddress, setLocationAddress] = useState(event.location?.address ?? "");
  const [locationCity, setLocationCity] = useState(event.location?.city ?? "");
  const [locationCountry, setLocationCountry] = useState(event.location?.country ?? "SN");

  // Cover image upload
  const [coverImageFile, setCoverImageFile] = useState<File | null>(null);
  const [coverImagePreview, setCoverImagePreview] = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const canEdit = event.status === "draft" || event.status === "published";

  const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 Mo

  const handleCoverImageSelect = useCallback((file: File) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error("Type de fichier non autorisé. Formats acceptés : JPG, PNG, WebP.");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      toast.error("Le fichier dépasse la taille maximale de 10 Mo.");
      return;
    }
    setCoverImageFile(file);
    const url = URL.createObjectURL(file);
    setCoverImagePreview(url);
  }, []);

  const handleCoverDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleCoverImageSelect(file);
    },
    [handleCoverImageSelect],
  );

  const handleCoverDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const removeCoverImage = useCallback(() => {
    setCoverImageFile(null);
    if (coverImagePreview) {
      URL.revokeObjectURL(coverImagePreview);
      setCoverImagePreview(null);
    }
    if (coverInputRef.current) coverInputRef.current.value = "";
  }, [coverImagePreview]);

  const handleStartEdit = () => {
    // Reset form values from current event data
    setTitle(event.title);
    setDescription(event.description);
    setShortDescription(event.shortDescription ?? "");
    setCategory(event.category);
    setFormat(event.format);
    setStartDate(event.startDate.slice(0, 16));
    setEndDate(event.endDate.slice(0, 16));
    setMaxAttendees(event.maxAttendees ? String(event.maxAttendees) : "");
    setTags((event.tags ?? []).join(", "));
    setLocationName(event.location?.name ?? "");
    setLocationAddress(event.location?.address ?? "");
    setLocationCity(event.location?.city ?? "");
    setLocationCountry(event.location?.country ?? "SN");
    setCoverImageFile(null);
    setCoverImagePreview(null);
    setEditing(true);
  };

  const handleCancel = () => {
    removeCoverImage();
    setEditing(false);
  };

  const handleSave = async () => {
    let coverImageURL = event.coverImageURL;

    // Upload new cover image if selected
    if (coverImageFile) {
      setUploadingCover(true);
      try {
        const { data } = await uploadsApi.getEventSignedUrl(event.id, {
          fileName: coverImageFile.name,
          contentType: coverImageFile.type,
          purpose: "cover",
        });

        const uploadResponse = await fetch(data.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": coverImageFile.type },
          body: coverImageFile,
        });

        if (!uploadResponse.ok) throw new Error("Upload échoué");
        coverImageURL = data.publicUrl;
      } catch {
        toast.error("Erreur lors du téléversement de l'image.");
        setUploadingCover(false);
        return;
      }
      setUploadingCover(false);
    }

    const dto: Partial<UpdateEventDto> = {
      title: title.trim(),
      description: description.trim(),
      shortDescription: shortDescription.trim() || null,
      coverImageURL: coverImageURL ?? undefined,
      category: category as UpdateEventDto["category"],
      format: format as UpdateEventDto["format"],
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
      maxAttendees: maxAttendees ? parseInt(maxAttendees, 10) : null,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      location: {
        name: locationName.trim(),
        address: locationAddress.trim(),
        city: locationCity.trim(),
        country: locationCountry.trim() || "SN",
      },
    };

    updateEvent.mutate(dto, {
      onSuccess: () => {
        toast.success("Événement mis à jour avec succès.");
        removeCoverImage();
        setEditing(false);
      },
      onError: (err: unknown) => {
        const code = (err as { code?: string })?.code;
        const message = (err as { message?: string })?.message;
        toast.error(getErrorMessage(code, message));
      },
    });
  };

  if (editing) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Modifier l&apos;événement
          </h2>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={updateEvent.isPending || uploadingCover}
            >
              <X className="h-4 w-4 mr-1.5" />
              Annuler
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateEvent.isPending || uploadingCover}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {updateEvent.isPending || uploadingCover ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {uploadingCover ? "Téléversement..." : "Enregistrement..."}
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Save className="h-4 w-4" />
                  Enregistrer
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* Cover Image Upload */}
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-2">
            Image de couverture
          </label>
          {coverImagePreview || event.coverImageURL ? (
            <div className="relative rounded-lg overflow-hidden border border-border">
              <img
                src={coverImagePreview || event.coverImageURL || ""}
                alt="Image de couverture"
                className="w-full h-48 object-cover"
              />
              <div className="absolute top-2 right-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  className="rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
                  aria-label="Changer l'image de couverture"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                {coverImageFile && (
                  <button
                    type="button"
                    onClick={removeCoverImage}
                    className="rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
                    aria-label="Annuler le changement d'image"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {coverImageFile && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs px-3 py-1.5">
                  Nouvelle image : {coverImageFile.name}
                </div>
              )}
            </div>
          ) : (
            <div
              onDrop={handleCoverDrop}
              onDragOver={handleCoverDragOver}
              onClick={() => coverInputRef.current?.click()}
              className="rounded-lg border-2 border-dashed border-border p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors"
              role="button"
              tabIndex={0}
              aria-label="Ajouter une image de couverture"
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") coverInputRef.current?.click();
              }}
            >
              <ImagePlus className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">Ajouter une image de couverture</p>
              <p className="mt-1 text-xs text-muted-foreground">JPG, PNG, WebP - max 10 Mo</p>
            </div>
          )}
          <input
            ref={coverInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleCoverImageSelect(file);
            }}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left column */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Titre</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Titre de l'événement"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Description
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder="Description de l'événement"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Description courte
              </label>
              <Input
                value={shortDescription}
                onChange={(e) => setShortDescription(e.target.value)}
                placeholder="Résumé court (max 300 car.)"
                maxLength={300}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  Catégorie
                </label>
                <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  Format
                </label>
                <Select value={format} onChange={(e) => setFormat(e.target.value)}>
                  {FORMAT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  Début
                </label>
                <Input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Fin</label>
                <Input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Capacité maximum
              </label>
              <Input
                type="number"
                value={maxAttendees}
                onChange={(e) => setMaxAttendees(e.target.value)}
                placeholder="Illimité"
                min={1}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Tags (séparés par des virgules)
              </label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="tech, conférence, dakar"
              />
            </div>
          </div>

          {/* Right column - Location */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <MapPin className="h-4 w-4" /> Lieu
            </h3>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Nom du lieu
              </label>
              <Input
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="Centre de conférence"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Adresse
              </label>
              <Input
                value={locationAddress}
                onChange={(e) => setLocationAddress(e.target.value)}
                placeholder="123 Rue..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  Ville
                </label>
                <Input
                  value={locationCity}
                  onChange={(e) => setLocationCity(e.target.value)}
                  placeholder="Dakar"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  Pays (code ISO)
                </label>
                <Input
                  value={locationCountry}
                  onChange={(e) => setLocationCountry(e.target.value)}
                  placeholder="SN"
                  maxLength={2}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Edit button */}
      {canEdit && (
        <div className="flex justify-end mb-4">
          <button
            onClick={handleStartEdit}
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
          >
            <Pencil className="h-4 w-4" />
            Éditer
          </button>
        </div>
      )}

      {/* Cover Image */}
      {event.coverImageURL && (
        <div className="mb-6 rounded-xl overflow-hidden border border-border">
          <img
            src={event.coverImageURL}
            alt={`Image de couverture de ${event.title}`}
            className="w-full h-48 object-cover"
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card rounded-xl border border-border p-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
              <Info className="h-4 w-4" /> Description
            </h3>
            <p className="text-sm text-foreground whitespace-pre-wrap">{event.description}</p>
          </div>
          {event.shortDescription && (
            <div className="bg-card rounded-xl border border-border p-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Description courte</h3>
              <p className="text-sm text-foreground">{event.shortDescription}</p>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Détails</h3>
            <dl className="text-sm space-y-3">
              <Field label="Catégorie" value={event.category} />
              <Field
                label="Format"
                value={
                  event.format === "in_person"
                    ? "Présentiel"
                    : event.format === "online"
                      ? "En ligne"
                      : "Hybride"
                }
              />
              <Field label="Début" value={formatDate(event.startDate)} />
              <Field label="Fin" value={formatDate(event.endDate)} />
              <Field label="Fuseau" value={event.timezone} />
              {event.isPublic !== undefined && (
                <Field label="Public" value={event.isPublic ? "Oui" : "Non"} />
              )}
              {event.requiresApproval && <Field label="Approbation" value="Requise" />}
            </dl>
          </div>
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Lieu</h3>
            <dl className="text-sm space-y-2">
              <Field label="Nom" value={event.location?.name} />
              <Field label="Adresse" value={event.location?.address} />
              <Field label="Ville" value={event.location?.city} />
              <Field label="Pays" value={event.location?.country} />
            </dl>
          </div>
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Statistiques</h3>
            <dl className="text-sm space-y-3">
              <Field label="Inscrits" value={String(event.registeredCount ?? 0)} />
              <Field label="Check-ins" value={String(event.checkedInCount ?? 0)} />
              {event.maxAttendees && (
                <Field label="Capacit\u00e9 max" value={String(event.maxAttendees)} />
              )}
            </dl>
            {event.maxAttendees &&
              (() => {
                const registered = event.registeredCount ?? 0;
                const pct = Math.min(100, (registered / event.maxAttendees) * 100);
                const isFull = pct >= 100;
                const barColor = isFull
                  ? "bg-red-500"
                  : pct >= 90
                    ? "bg-red-500"
                    : pct >= 70
                      ? "bg-amber-500"
                      : "bg-green-500";
                return (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted-foreground">
                        {registered} / {event.maxAttendees} places
                      </span>
                      {isFull ? (
                        <Badge variant="warning">Complet</Badge>
                      ) : (
                        <span
                          className={`font-medium ${pct >= 90 ? "text-red-600" : pct >= 70 ? "text-amber-600" : "text-green-600"}`}
                        >
                          {Math.round(pct)}%
                        </span>
                      )}
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted">
                      <div
                        className={`h-2 rounded-full ${barColor} transition-all`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })()}
          </div>
          {event.tags && event.tags.length > 0 && (
            <div className="bg-card rounded-xl border border-border p-5">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {event.tags.map((tag) => (
                  <span
                    key={tag}
                    className="bg-accent text-muted-foreground text-xs px-2.5 py-1 rounded-full"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground font-medium">{value || "—"}</dd>
    </div>
  );
}

function TicketsTab({ event }: { event: Event }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState(0);
  const [newQty, setNewQty] = useState("");
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const addTicket = useAddTicketType(event.id);
  const removeTicket = useRemoveTicketType(event.id);

  function handleAdd() {
    if (!newName.trim()) return;
    const dto: CreateTicketTypeDto = {
      name: newName.trim(),
      price: newPrice,
      currency: "XOF",
      totalQuantity: newQty ? parseInt(newQty, 10) : null,
      isVisible: true,
      accessZoneIds: [],
    };
    addTicket.mutate(dto, {
      onSuccess: () => {
        setShowAdd(false);
        setNewName("");
        setNewPrice(0);
        setNewQty("");
        toast.success("Type de billet ajouté.");
      },
      onError: (err: unknown) => {
        const code = (err as { code?: string })?.code;
        const message = (err as { message?: string })?.message;
        toast.error(getErrorMessage(code, message));
      },
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Ticket className="h-4 w-4" /> {event.ticketTypes?.length ?? 0} type(s) de billet
        </h3>
        {event.status === "draft" && (
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
          >
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        )}
      </div>

      {showAdd && (
        <div className="bg-muted rounded-lg p-4 mb-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <input
              type="text"
              placeholder="Nom du billet"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <input
              type="number"
              min={0}
              placeholder="Prix (XOF)"
              value={newPrice}
              onChange={(e) => setNewPrice(Number(e.target.value))}
              className="px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <input
              type="number"
              min={1}
              placeholder="Quantité (vide = illimité)"
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={addTicket.isPending}
              className="bg-primary text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {addTicket.isPending ? "Ajout..." : "Ajouter le billet"}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {!event.ticketTypes || event.ticketTypes.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-8 text-center text-muted-foreground">
          Aucun type de billet configuré.
        </div>
      ) : (
        <div className="space-y-3">
          {event.ticketTypes.map((tt) => {
            const ttPct = tt.totalQuantity
              ? Math.min(100, (tt.soldCount / tt.totalQuantity) * 100)
              : null;
            const ttFull = ttPct !== null && ttPct >= 100;
            const ttBarColor =
              ttPct === null
                ? ""
                : ttFull
                  ? "bg-red-500"
                  : ttPct >= 90
                    ? "bg-red-500"
                    : ttPct >= 70
                      ? "bg-amber-500"
                      : "bg-green-500";
            return (
              <div key={tt.id} className="bg-card rounded-xl border border-border p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">{tt.name}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {tt.price === 0 ? "Gratuit" : formatCurrency(tt.price, tt.currency)} ·{" "}
                      {tt.soldCount}/{tt.totalQuantity ?? "\u221e"} vendus
                      {!tt.isVisible && " · Masqu\u00e9"}
                      {ttFull && (
                        <Badge variant="warning" className="ml-2">
                          Complet
                        </Badge>
                      )}
                    </p>
                  </div>
                  {event.status === "draft" && (
                    <button
                      onClick={() => setRemoveTarget({ id: tt.id, name: tt.name })}
                      className="text-red-400 hover:text-red-600 p-1"
                      aria-label="Supprimer le billet"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {tt.totalQuantity && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted-foreground">
                        {tt.soldCount} / {tt.totalQuantity} places
                      </span>
                      <span
                        className={`font-medium ${ttPct !== null && ttPct >= 90 ? "text-red-600" : ttPct !== null && ttPct >= 70 ? "text-amber-600" : "text-green-600"}`}
                      >
                        {Math.round(ttPct ?? 0)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted">
                      <div
                        className={`h-1.5 rounded-full ${ttBarColor} transition-all`}
                        style={{ width: `${ttPct ?? 0}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        onConfirm={() => {
          if (removeTarget) {
            removeTicket.mutate(removeTarget.id, {
              onSuccess: () => toast.success("Type de billet supprimé."),
              onError: (err: unknown) => {
                const code = (err as { code?: string })?.code;
                const message = (err as { message?: string })?.message;
                toast.error(getErrorMessage(code, message));
              },
            });
          }
          setRemoveTarget(null);
        }}
        onCancel={() => setRemoveTarget(null)}
        title="Supprimer le billet"
        description={`Êtes-vous sûr(e) de vouloir supprimer le billet « ${removeTarget?.name} » ?`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        variant="danger"
      />
    </div>
  );
}

function RegistrationsTab({ eventId }: { eventId: string }) {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const limit = 15;

  const { data, isLoading } = useEventRegistrations(eventId, {
    page,
    limit,
    status: statusFilter || undefined,
  });
  const approve = useApproveRegistration();
  const cancelReg = useCancelRegistration();
  const promote = usePromoteRegistration();

  const registrations = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? 1;
  const waitlistedCount = registrations.filter((r) => r.status === "waitlisted").length;

  const csvData = registrations.map((r) => ({
    participantName: r.participantName ?? r.userId,
    participantEmail: r.participantEmail ?? "",
    status: REG_STATUS[r.status] ?? r.status,
    createdAt: r.createdAt,
    ticketTypeName: r.ticketTypeName ?? r.ticketTypeId,
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Users className="h-4 w-4" /> {meta?.total ?? 0} inscription(s)
        </h3>
        <div className="flex items-center gap-2">
          {/* Bulk approve pending */}
          {registrations.some((r) => r.status === "pending") && (
            <button
              onClick={async () => {
                const pendingIds = registrations
                  .filter((r) => r.status === "pending")
                  .map((r) => r.id);
                for (const id of pendingIds) {
                  try {
                    await approve.mutateAsync(id);
                  } catch {
                    /* skip errors */
                  }
                }
                toast.success(`${pendingIds.length} inscription(s) approuvée(s)`);
              }}
              disabled={approve.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50"
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Approuver tout ({registrations.filter((r) => r.status === "pending").length})
            </button>
          )}
          {/* Bulk promote waitlisted */}
          {waitlistedCount > 0 && (
            <button
              onClick={async () => {
                const waitlistedIds = registrations
                  .filter((r) => r.status === "waitlisted")
                  .map((r) => r.id);
                for (const id of waitlistedIds) {
                  try {
                    await promote.mutateAsync(id);
                  } catch {
                    /* skip errors */
                  }
                }
                toast.success(`${waitlistedIds.length} inscription(s) promue(s)`);
              }}
              disabled={promote.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-medium hover:bg-amber-600 disabled:opacity-50"
            >
              <ArrowUpCircle className="h-3.5 w-3.5" />
              Promouvoir tout ({waitlistedCount})
            </button>
          )}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-1.5 rounded-lg border border-border text-sm bg-card focus:outline-none"
          >
            <option value="">Tous les statuts</option>
            <option value="confirmed">Confirmé</option>
            <option value="pending">En attente</option>
            <option value="pending_payment">Paiement en attente</option>
            <option value="waitlisted">Liste d&apos;attente</option>
            <option value="cancelled">Annulé</option>
            <option value="checked_in">Entré</option>
          </select>
          <PlanGate feature="csvExport" fallback="disabled">
            <CsvExportButton
              data={csvData}
              columns={CSV_COLUMNS}
              filename={`participants-${eventId.slice(0, 8)}`}
            />
          </PlanGate>
        </div>
      </div>

      {isLoading ? (
        <div
          className="bg-card rounded-xl border border-border overflow-hidden"
          role="status"
          aria-label="Chargement des inscriptions"
        >
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4">
                <Skeleton variant="circle" className="h-10 w-10 shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ) : registrations.length === 0 ? (
        <div className="bg-card rounded-xl border border-border">
          <EmptyState
            icon={Users}
            title="Aucune inscription pour le moment"
            description="Partagez le lien de votre événement pour recevoir vos premières inscriptions."
          />
        </div>
      ) : (
        <>
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground font-medium">
                  <th className="px-6 py-3">ID</th>
                  <th className="px-6 py-3">Participant</th>
                  <th className="px-6 py-3">Billet</th>
                  <th className="px-6 py-3">Statut</th>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {registrations.map((reg) => {
                  return (
                    <tr key={reg.id} className="border-b border-border/50 hover:bg-muted/50">
                      <td className="px-6 py-3 text-muted-foreground font-mono text-xs">
                        {reg.id.slice(0, 8)}
                      </td>
                      <td className="px-6 py-3 text-foreground">
                        {reg.participantName ? (
                          <div>
                            <span className="font-medium">{reg.participantName}</span>
                            {reg.participantEmail && (
                              <span className="block text-xs text-muted-foreground">
                                {reg.participantEmail}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">
                            {reg.userId.slice(0, 12)}...
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-muted-foreground">
                        {reg.ticketTypeName ?? reg.ticketTypeId.slice(0, 8)}
                      </td>
                      <td className="px-6 py-3">
                        <Badge variant={getStatusVariant(reg.status)}>
                          {REG_STATUS[reg.status] ?? reg.status}
                        </Badge>
                      </td>
                      <td className="px-6 py-3 text-muted-foreground text-xs">
                        {formatDate(reg.createdAt)}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {reg.status === "pending" && (
                            <button
                              onClick={() =>
                                approve.mutate(reg.id, {
                                  onSuccess: () => toast.success("Inscription approuvée."),
                                  onError: (err: unknown) => {
                                    const code = (err as { code?: string })?.code;
                                    const message = (err as { message?: string })?.message;
                                    toast.error(getErrorMessage(code, message));
                                  },
                                })
                              }
                              disabled={approve.isPending}
                              className="text-green-600 hover:text-green-800 p-1"
                              title="Approuver"
                              aria-label="Approuver l'inscription"
                            >
                              <CheckCircle className="h-4 w-4" />
                            </button>
                          )}
                          {reg.status === "waitlisted" && (
                            <button
                              onClick={() =>
                                promote.mutate(reg.id, {
                                  onSuccess: () =>
                                    toast.success("Inscription promue en confirmée."),
                                  onError: (err: unknown) => {
                                    const code = (err as { code?: string })?.code;
                                    const message = (err as { message?: string })?.message;
                                    toast.error(getErrorMessage(code, message));
                                  },
                                })
                              }
                              disabled={promote.isPending}
                              className="text-amber-500 hover:text-amber-700 p-1"
                              title="Promouvoir"
                              aria-label="Promouvoir l'inscription"
                            >
                              <ArrowUpCircle className="h-4 w-4" />
                            </button>
                          )}
                          {(reg.status === "pending" ||
                            reg.status === "confirmed" ||
                            reg.status === "waitlisted") && (
                            <button
                              onClick={() =>
                                cancelReg.mutate(reg.id, {
                                  onSuccess: () => toast.success("Inscription annulée."),
                                  onError: (err: unknown) => {
                                    const code = (err as { code?: string })?.code;
                                    const message = (err as { message?: string })?.message;
                                    toast.error(getErrorMessage(code, message));
                                  },
                                })
                              }
                              disabled={cancelReg.isPending}
                              className="text-red-400 hover:text-red-600 p-1"
                              title="Annuler"
                              aria-label="Annuler l'inscription"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
              <span>
                Page {page} sur {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Page précédente"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label="Page suivante"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Access Zones Tab ──────────────────────────────────────────────────────

function AccessZonesTab({ event }: { event: Event }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3B82F6");
  const [capacity, setCapacity] = useState("");

  const addZone = useAddAccessZone(event.id);
  const removeZone = useRemoveAccessZone(event.id);

  const handleAdd = async () => {
    if (!name.trim()) return;
    const dto: CreateAccessZoneDto = {
      name: name.trim(),
      color,
      capacity: capacity ? parseInt(capacity, 10) : null,
      allowedTicketTypes: [],
    };
    await addZone.mutateAsync(dto);
    setName("");
    setColor("#3B82F6");
    setCapacity("");
    setShowForm(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <MapPin className="h-5 w-5" /> Zones d'acces
        </h2>
        {event.status === "draft" && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-muted rounded-lg p-4 mb-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Nom</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Zone VIP"
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Couleur</label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-full h-9 rounded-lg border cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Capacite (optionnel)
              </label>
              <input
                type="number"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="Illimite"
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={addZone.isPending || !name.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
            >
              {addZone.isPending ? "Ajout..." : "Ajouter la zone"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border rounded-lg text-sm hover:bg-accent"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {event.accessZones.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <MapPin className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>Aucune zone d'acces configuree</p>
          <p className="text-sm mt-1">Les zones permettent de controler l'entree par secteur</p>
        </div>
      ) : (
        <div className="space-y-3">
          {event.accessZones.map((zone) => (
            <div
              key={zone.id}
              className="bg-card border rounded-lg p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: zone.color }} />
                <div>
                  <span className="font-medium text-foreground">{zone.name}</span>
                  {zone.capacity && (
                    <span className="text-sm text-muted-foreground ml-2">
                      Capacite: {zone.capacity}
                    </span>
                  )}
                </div>
              </div>
              {event.status === "draft" && (
                <button
                  onClick={() => removeZone.mutate(zone.id)}
                  disabled={removeZone.isPending}
                  className="p-2 rounded-lg text-red-500 hover:bg-red-50"
                  aria-label="Supprimer la zone"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sessions Tab ────────────────────────────────────────────────────────────

function SessionsTab({ eventId, eventStatus }: { eventId: string; eventStatus: string }) {
  const { data, isLoading } = useSessions(eventId);
  const createSession = useCreateSession(eventId);
  const deleteSession = useDeleteSession(eventId);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [sessionLoc, setSessionLoc] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const sessions = data?.data ?? [];

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  const handleAdd = async () => {
    if (!title.trim() || !startTime || !endTime) return;
    const dto: CreateSessionDto = {
      eventId,
      title: title.trim(),
      description: desc || null,
      location: sessionLoc || null,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      speakerIds: [],
      tags: [],
      isBookmarkable: true,
    };
    try {
      await createSession.mutateAsync(dto);
      setTitle("");
      setDesc("");
      setSessionLoc("");
      setStartTime("");
      setEndTime("");
      setShowForm(false);
      toast.success("Session ajoutée.");
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      const message = (err as { message?: string })?.message;
      toast.error(getErrorMessage(code, message));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Calendar className="h-4 w-4" /> {sessions.length} session(s)
        </h3>
        {(eventStatus === "draft" || eventStatus === "published") && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
          >
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-muted rounded-lg p-4 mb-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Titre</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Keynote d'ouverture"
                className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Début</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Fin</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Salle / Lieu
              </label>
              <input
                type="text"
                value={sessionLoc}
                onChange={(e) => setSessionLoc(e.target.value)}
                placeholder="Ex: Salle A"
                className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Description
              </label>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={createSession.isPending || !title.trim() || !startTime || !endTime}
              className="bg-primary text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {createSession.isPending ? "Ajout..." : "Ajouter la session"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div
          className="space-y-3"
          role="status"
          aria-label="Chargement des sessions"
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-card rounded-xl border border-border p-4 space-y-2"
            >
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="bg-card rounded-xl border border-border">
          <EmptyState
            icon={Calendar}
            title="Aucune session programmée"
            description="Ajoutez des sessions pour construire l'agenda de votre événement."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="bg-card rounded-xl border border-border p-5 flex items-start justify-between"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium text-foreground">{session.title}</p>
                  {session.location && (
                    <span className="text-xs bg-accent text-muted-foreground px-2 py-0.5 rounded-full">
                      {session.location}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {formatDate(session.startTime)} —{" "}
                    {formatDate(session.endTime)}
                  </span>
                  {session.speakerIds.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Mic className="h-3 w-3" /> {session.speakerIds.length} intervenant(s)
                    </span>
                  )}
                </div>
                {session.description && (
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                    {session.description}
                  </p>
                )}
              </div>
              <button
                onClick={() => setDeleteTarget({ id: session.id, title: session.title })}
                className="text-red-400 hover:text-red-600 p-1 ml-3"
                aria-label="Supprimer la session"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onConfirm={() => {
          if (deleteTarget) {
            deleteSession.mutate(deleteTarget.id, {
              onSuccess: () => toast.success("Session supprimée."),
              onError: (err: unknown) => {
                const code = (err as { code?: string })?.code;
                const message = (err as { message?: string })?.message;
                toast.error(getErrorMessage(code, message));
              },
            });
          }
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
        title="Supprimer la session"
        description={`Êtes-vous sûr(e) de vouloir supprimer « ${deleteTarget?.title} » ?`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        variant="danger"
      />
    </div>
  );
}

// ─── Feed Tab ────────────────────────────────────────────────────────────────

function FeedTab({ eventId }: { eventId: string }) {
  const { data, isLoading } = useFeedPosts(eventId);
  const createPost = useCreateFeedPost(eventId);
  const deletePost = useDeleteFeedPost(eventId);
  const togglePin = useTogglePin(eventId);
  const [content, setContent] = useState("");
  const [isAnnouncement, setIsAnnouncement] = useState(false);
  const [deletePostTarget, setDeletePostTarget] = useState<string | null>(null);

  const posts = data?.data ?? [];

  const handlePost = async () => {
    if (!content.trim()) return;
    try {
      await createPost.mutateAsync({ content: content.trim(), mediaURLs: [], isAnnouncement });
      setContent("");
      setIsAnnouncement(false);
      toast.success("Publication créée.");
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      const message = (err as { message?: string })?.message;
      toast.error(getErrorMessage(code, message));
    }
  };

  return (
    <div>
      <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2 mb-4">
        <MessageSquare className="h-4 w-4" /> Feed de l&apos;événement
      </h3>

      <div className="bg-card rounded-xl border border-border p-4 mb-4">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Publier une mise à jour..."
          rows={3}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 mb-3"
        />
        <div className="flex items-center justify-between">
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={isAnnouncement}
              onChange={(e) => setIsAnnouncement(e.target.checked)}
              className="rounded border-border"
            />
            Annonce (notification à tous)
          </label>
          <button
            onClick={handlePost}
            disabled={createPost.isPending || !content.trim()}
            className="bg-primary text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {createPost.isPending ? "Publication..." : "Publier"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div
          className="space-y-3"
          role="status"
          aria-label="Chargement des publications"
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-card rounded-xl border border-border p-4 space-y-2"
            >
              <div className="flex items-center gap-3">
                <Skeleton variant="circle" className="h-8 w-8" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="bg-card rounded-xl border border-border">
          <EmptyState
            icon={MessageSquare}
            title="Aucune publication"
            description="Publiez une annonce ou une mise à jour pour vos participants."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <div
              key={post.id}
              className={`bg-card rounded-xl border p-5 ${post.isPinned ? "border-amber-200 bg-amber-50/30" : "border-border"}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-foreground">{post.authorName}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(post.createdAt)}
                    </span>
                    {post.isAnnouncement && <Badge variant="info">Annonce</Badge>}
                    {post.isPinned && <Badge variant="warning">Épinglé</Badge>}
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{post.content}</p>
                  <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                    <span>{post.likeCount} j&apos;aime</span>
                    <span>{post.commentCount} commentaire(s)</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-3">
                  <button
                    onClick={() => togglePin.mutate(post.id)}
                    className={`p-1.5 rounded-lg text-xs ${post.isPinned ? "text-amber-600 hover:bg-amber-50" : "text-muted-foreground hover:text-muted-foreground hover:bg-muted"}`}
                    title={post.isPinned ? "Désépingler" : "Épingler"}
                  >
                    Pin
                  </button>
                  <button
                    onClick={() => setDeletePostTarget(post.id)}
                    className="text-red-400 hover:text-red-600 p-1.5"
                    aria-label="Supprimer la publication"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deletePostTarget !== null}
        onConfirm={() => {
          if (deletePostTarget) {
            deletePost.mutate(deletePostTarget, {
              onSuccess: () => toast.success("Publication supprimée."),
              onError: (err: unknown) => {
                const code = (err as { code?: string })?.code;
                const message = (err as { message?: string })?.message;
                toast.error(getErrorMessage(code, message));
              },
            });
          }
          setDeletePostTarget(null);
        }}
        onCancel={() => setDeletePostTarget(null)}
        title="Supprimer la publication"
        description="Êtes-vous sûr(e) de vouloir supprimer cette publication ?"
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        variant="danger"
      />
    </div>
  );
}

// ─── Payments Tab ──────────────────────────────────────────────────────────────

// Status pills — className strings include dark: overrides so they
// render correctly in both themes (theme-factory: dark-mode contrast ≥ 4.5:1).
const PAYMENT_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "En attente", className: "bg-accent text-foreground" },
  processing: {
    label: "En cours",
    className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  },
  succeeded: {
    label: "Confirmé",
    className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  },
  failed: {
    label: "Échoué",
    className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  },
  refunded: {
    label: "Remboursé",
    className: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  },
  expired: { label: "Expiré", className: "bg-accent text-muted-foreground" },
};

const PAYMENT_METHOD: Record<string, string> = {
  wave: "Wave",
  orange_money: "Orange Money",
  free_money: "Free Money",
  card: "Carte bancaire",
  mock: "Test",
};

function PaymentsTab({ eventId }: { eventId: string }) {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [refundTarget, setRefundTarget] = useState<Payment | null>(null);

  const { data: paymentsData, isLoading: paymentsLoading } = useEventPayments(eventId, {
    status: statusFilter || undefined,
    page,
    limit: 20,
  });
  const { data: summaryData, isLoading: summaryLoading } = usePaymentSummary(eventId);
  const refundMutation = useRefundPayment();

  const payments = (paymentsData as { data?: Payment[] })?.data as Payment[] | undefined;
  const meta = (paymentsData as { meta?: { total: number; totalPages: number; page: number } })
    ?.meta;
  const summary = (summaryData as { data?: PaymentSummary })?.data as PaymentSummary | undefined;

  const handleRefund = () => {
    if (!refundTarget) return;
    refundMutation.mutate(
      { paymentId: refundTarget.id },
      {
        onSuccess: () => {
          toast.success("Remboursement effectué.");
          setRefundTarget(null);
        },
        onError: (err: unknown) => {
          const code = (err as { code?: string })?.code;
          const message = (err as { message?: string })?.message;
          toast.error(getErrorMessage(code, message));
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      {/* Revenue Summary */}
      {!summaryLoading && summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Revenus totaux</p>
            <p className="mt-1 text-2xl font-bold text-green-600">
              {formatCurrency(summary.totalRevenue, "XOF")}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Remboursements</p>
            <p className="mt-1 text-2xl font-bold text-red-500">
              {formatCurrency(summary.totalRefunded, "XOF")}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Revenus nets</p>
            <p className="mt-1 text-2xl font-bold text-foreground">
              {formatCurrency(summary.netRevenue, "XOF")}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Paiements</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{summary.paymentCount}</p>
          </div>
          {summary.byStatus?.failed != null && summary.byStatus.failed > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-xs text-red-500 uppercase tracking-wide">Échoués</p>
              <p className="mt-1 text-2xl font-bold text-red-600">{summary.byStatus.failed}</p>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          <option value="">Tous les statuts</option>
          <option value="succeeded">Confirmé</option>
          <option value="processing">En cours</option>
          <option value="pending">En attente</option>
          <option value="failed">Échoué</option>
          <option value="refunded">Remboursé</option>
          <option value="expired">Expiré</option>
        </select>
        {meta && (
          <span className="text-sm text-muted-foreground">
            {meta.total} paiement{meta.total > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Payments Table */}
      {paymentsLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {payments && payments.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Ticket className="mx-auto h-10 w-10 mb-3 opacity-50" />
          <p>Aucun paiement pour cet événement.</p>
        </div>
      )}

      {payments && payments.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Montant</th>
                <th className="px-4 py-3">Méthode</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Remboursé</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payments.map((p) => {
                const st = PAYMENT_STATUS[p.status] ?? PAYMENT_STATUS.pending;
                const methodLabel = PAYMENT_METHOD[p.method] ?? p.method;
                const canRefund = p.status === "succeeded" && p.refundedAmount < p.amount;

                return (
                  <tr
                    key={p.id}
                    className={`hover:bg-muted ${p.status === "failed" ? "bg-red-50/50" : ""}`}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(p.createdAt)}</td>
                    <td className="px-4 py-3 font-medium">
                      {formatCurrency(p.amount, p.currency)}
                    </td>
                    <td className="px-4 py-3">{methodLabel}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${st.className}`}
                      >
                        {st.label}
                      </span>
                      {p.status === "failed" && (p as Record<string, unknown>).failureReason ? (
                        <p
                          className="mt-1 text-xs text-red-500 max-w-[200px] truncate"
                          title={String((p as Record<string, unknown>).failureReason)}
                        >
                          {String((p as Record<string, unknown>).failureReason)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {p.refundedAmount > 0 ? formatCurrency(p.refundedAmount, p.currency) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {canRefund && (
                        <button
                          onClick={() => setRefundTarget(p)}
                          className="text-xs text-red-600 hover:text-red-800 font-medium"
                        >
                          Rembourser
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => setPage(page - 1)}
            disabled={page <= 1}
            className="p-1.5 rounded-lg hover:bg-accent disabled:opacity-30"
            aria-label="Page précédente"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm text-muted-foreground">
            Page {page} / {meta.totalPages}
          </span>
          <button
            onClick={() => setPage(page + 1)}
            disabled={page >= meta.totalPages}
            className="p-1.5 rounded-lg hover:bg-accent disabled:opacity-30"
            aria-label="Page suivante"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Refund Confirmation */}
      <ConfirmDialog
        open={refundTarget !== null}
        onConfirm={handleRefund}
        onCancel={() => setRefundTarget(null)}
        title="Rembourser le paiement"
        description={
          refundTarget
            ? `Rembourser ${formatCurrency(refundTarget.amount - refundTarget.refundedAmount, refundTarget.currency)} ? L'inscription sera annulée.`
            : ""
        }
        confirmLabel="Rembourser"
        cancelLabel="Annuler"
        variant="danger"
      />
    </div>
  );
}

// ─── Speakers Tab ─────────────────────────────────────────────────────────

function SpeakersTab({ eventId }: { eventId: string }) {
  const { data, isLoading } = useEventSpeakers(eventId);
  const speakers = (data?.data ?? []) as SpeakerProfile[];
  const createSpeaker = useCreateSpeaker();
  const deleteSpeaker = useDeleteSpeaker();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [bio, setBio] = useState("");

  const handleCreate = async () => {
    if (!name) return;
    try {
      await createSpeaker.mutateAsync({
        eventId,
        dto: {
          eventId,
          name,
          title: title || undefined,
          company: company || undefined,
          bio: bio || undefined,
        },
      });
      setShowForm(false);
      setName("");
      setTitle("");
      setCompany("");
      setBio("");
      toast.success("Intervenant ajoute");
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      toast.error(getErrorMessage(code));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Intervenants ({speakers.length})</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
        >
          <Plus className="h-4 w-4" /> Ajouter
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border p-4 space-y-3 bg-muted">
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="Nom *"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="Titre (ex: CTO)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="Entreprise"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
          <textarea
            className="w-full rounded border px-3 py-2 text-sm"
            rows={3}
            placeholder="Biographie"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={createSpeaker.isPending || !name}
              className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50"
            >
              {createSpeaker.isPending ? "Ajout..." : "Ajouter"}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 border rounded text-sm">
              Annuler
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : speakers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Aucun intervenant"
          description="Invitez des intervenants pour animer votre événement."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {speakers.map((s) => (
            <div key={s.id} className="rounded-lg border p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {s.photoURL ? (
                    <img
                      src={s.photoURL}
                      alt={s.name}
                      className="h-10 w-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                      <UserRound className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div>
                    <p className="font-medium">{s.name}</p>
                    {s.title && (
                      <p className="text-xs text-muted-foreground">
                        {s.title}
                        {s.company ? ` — ${s.company}` : ""}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (confirm("Retirer cet intervenant ?")) deleteSpeaker.mutate(s.id);
                  }}
                  className="text-muted-foreground hover:text-red-500"
                  aria-label="Supprimer l'intervenant"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {s.bio && <p className="text-sm text-muted-foreground line-clamp-2">{s.bio}</p>}
              {s.topics.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {s.topics.map((t) => (
                    <span key={t} className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sponsors Tab ─────────────────────────────────────────────────────────

// Sponsor-tier pills — dark: overrides included for WCAG 2.1 AA in dark mode.
const TIER_LABELS: Record<string, { label: string; className: string }> = {
  platinum: { label: "Platine", className: "bg-muted text-foreground" },
  gold: {
    label: "Or",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  },
  silver: { label: "Argent", className: "bg-accent text-muted-foreground" },
  bronze: {
    label: "Bronze",
    className: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  },
  partner: {
    label: "Partenaire",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  },
};

function SponsorsTab({ eventId }: { eventId: string }) {
  const { data, isLoading } = useEventSponsors(eventId);
  const sponsors = (data?.data ?? []) as SponsorProfile[];
  const createSponsor = useCreateSponsor();
  const deleteSponsor = useDeleteSponsor();

  const [showForm, setShowForm] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [tier, setTier] = useState<SponsorTier>("gold");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");

  const handleCreate = async () => {
    if (!companyName) return;
    try {
      await createSponsor.mutateAsync({
        eventId,
        dto: {
          eventId,
          companyName,
          tier,
          website: website || undefined,
          description: description || undefined,
        },
      });
      setShowForm(false);
      setCompanyName("");
      setWebsite("");
      setDescription("");
      toast.success("Sponsor ajoute");
    } catch (err) {
      toast.error(getErrorMessage((err as { code?: string })?.code));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Sponsors ({sponsors.length})</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
        >
          <Plus className="h-4 w-4" /> Ajouter
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border p-4 space-y-3 bg-muted">
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="Nom de l'entreprise *"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            value={tier}
            onChange={(e) => setTier(e.target.value as SponsorTier)}
          >
            {Object.entries(TIER_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            placeholder="Site web"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
          <textarea
            className="w-full rounded border px-3 py-2 text-sm"
            rows={3}
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={createSponsor.isPending || !companyName}
              className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50"
            >
              {createSponsor.isPending ? "Ajout..." : "Ajouter"}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 border rounded text-sm">
              Annuler
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : sponsors.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Aucun sponsor"
          description="Ajoutez des sponsors pour faire rayonner leur marque sur votre événement."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sponsors.map((s) => {
            const tierInfo = TIER_LABELS[s.tier] ?? TIER_LABELS.partner;
            return (
              <div key={s.id} className="rounded-lg border p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {s.logoURL ? (
                      <img
                        src={s.logoURL}
                        alt={s.companyName}
                        className="h-10 w-10 rounded object-contain"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded bg-muted">
                        <Building className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div>
                      <p className="font-medium">{s.companyName}</p>
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tierInfo.className}`}
                      >
                        {tierInfo.label}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm("Retirer ce sponsor ?")) deleteSponsor.mutate(s.id);
                    }}
                    className="text-muted-foreground hover:text-red-500"
                    aria-label="Supprimer le sponsor"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {s.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{s.description}</p>
                )}
                {s.website && (
                  <a
                    href={s.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-500 hover:underline"
                  >
                    {s.website}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Promos Tab ──────────────────────────────────────────────────────── */

function PromosTab({ eventId }: { eventId: string }) {
  const { data, isLoading } = useEventPromoCodes(eventId);
  const promoCodes = (data?.data ?? []) as Array<{
    id: string;
    code: string;
    discountType: "percentage" | "fixed";
    discountValue: number;
    maxUses: number | null;
    usedCount: number;
    expiresAt: string | null;
    isActive: boolean;
    ticketTypeIds: string[];
    createdAt: string;
  }>;
  const createPromo = useCreatePromoCode(eventId);
  const deactivatePromo = useDeactivatePromoCode();

  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">("percentage");
  const [discountValue, setDiscountValue] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const handleCreate = async () => {
    if (!code || !discountValue) return;
    try {
      await createPromo.mutateAsync({
        code: code.toUpperCase(),
        discountType,
        discountValue: Number(discountValue),
        ...(maxUses ? { maxUses: Number(maxUses) } : {}),
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      });
      setShowForm(false);
      setCode("");
      setDiscountValue("");
      setMaxUses("");
      setExpiresAt("");
      toast.success("Code promo créé");
    } catch (err) {
      toast.error(getErrorMessage((err as { code?: string })?.code));
    }
  };

  const handleDeactivate = async (promoCodeId: string) => {
    if (!confirm("Désactiver ce code promo ?")) return;
    try {
      await deactivatePromo.mutateAsync(promoCodeId);
      toast.success("Code promo désactivé");
    } catch (err) {
      toast.error(getErrorMessage((err as { code?: string })?.code));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Codes promo ({promoCodes.length})</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
        >
          <Plus className="h-4 w-4" /> Créer un code
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border p-4 space-y-3 bg-muted">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="w-full rounded border px-3 py-2 text-sm uppercase"
              placeholder="Code (ex: DAKAR2026) *"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <select
              className="w-full rounded border px-3 py-2 text-sm"
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as "percentage" | "fixed")}
            >
              <option value="percentage">Pourcentage (%)</option>
              <option value="fixed">Montant fixe (XOF)</option>
            </select>
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              type="number"
              placeholder={discountType === "percentage" ? "Réduction (%) *" : "Montant (XOF) *"}
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              min="1"
              max={discountType === "percentage" ? "100" : undefined}
            />
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              type="number"
              placeholder="Utilisations max (optionnel)"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              min="1"
            />
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={createPromo.isPending || !code || !discountValue}
              className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50"
            >
              {createPromo.isPending ? "Création..." : "Créer"}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 border rounded text-sm">
              Annuler
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : promoCodes.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">Aucun code promo</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Code</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Réduction</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Utilisations
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Expiration
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Statut</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {promoCodes.map((p) => {
                const expired = p.expiresAt && new Date(p.expiresAt) < new Date();
                const maxedOut = p.maxUses !== null && p.usedCount >= p.maxUses;
                const active = p.isActive && !expired && !maxedOut;

                return (
                  <tr key={p.id} className={!active ? "opacity-60" : ""}>
                    <td className="px-4 py-3 font-mono font-medium">{p.code}</td>
                    <td className="px-4 py-3">
                      {p.discountType === "percentage"
                        ? `${p.discountValue}%`
                        : formatCurrency(p.discountValue)}
                    </td>
                    <td className="px-4 py-3">
                      {p.usedCount}
                      {p.maxUses !== null ? ` / ${p.maxUses}` : ""}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {p.expiresAt ? formatDate(p.expiresAt) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {!p.isActive ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-accent text-muted-foreground">
                          Désactivé
                        </span>
                      ) : expired ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">
                          Expiré
                        </span>
                      ) : maxedOut ? (
                        <Badge variant="warning">Épuisé</Badge>
                      ) : (
                        <Badge variant="success">Actif</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {p.isActive && (
                        <button
                          onClick={() => handleDeactivate(p.id)}
                          className="text-xs text-red-500 hover:underline"
                          disabled={deactivatePromo.isPending}
                        >
                          Désactiver
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
