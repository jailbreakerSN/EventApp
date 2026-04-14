"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useCreateEvent } from "@/hooks/use-events";
import { useAuth } from "@/hooks/use-auth";
import { uploadsApi } from "@/lib/api-client";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Loader2, ImagePlus, X } from "lucide-react";
import Link from "next/link";
import {
  Select,
  Textarea,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@teranga/shared-ui";
import type { CreateEventDto } from "@teranga/shared-types";
import { VenueSelector } from "@/components/venue-selector";
import { useTranslations } from "next-intl";

const STEPS = ["Détails", "Lieu", "Billets", "Paramètres"] as const;

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

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 Mo

interface TicketDraft {
  name: string;
  description: string;
  price: number;
  currency: "XOF" | "EUR" | "USD";
  totalQuantity: number | null;
  isVisible: boolean;
}

const emptyTicket: TicketDraft = {
  name: "",
  description: "",
  price: 0,
  currency: "XOF",
  totalQuantity: null,
  isVisible: true,
};

export default function NewEventPage() {
  const tCommon = useTranslations("common"); void tCommon;
  const router = useRouter();
  const { user } = useAuth();
  const createEvent = useCreateEvent();
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Step 1: Details
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [category, setCategory] = useState("conference");
  const [format, setFormat] = useState("in_person");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [tags, setTags] = useState("");

  // Cover image
  const [coverImageFile, setCoverImageFile] = useState<File | null>(null);
  const [coverImagePreview, setCoverImagePreview] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // Step 2: Location
  const [venueId, setVenueId] = useState<string | null>(null);
  const [venueName, setVenueName] = useState<string | null>(null);
  const [locationName, setLocationName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("Dakar");
  const [country, setCountry] = useState("SN");
  const [streamUrl, setStreamUrl] = useState("");

  // Step 3: Tickets
  const [tickets, setTickets] = useState<TicketDraft[]>([{ ...emptyTicket, name: "Standard" }]);

  // Step 4: Settings
  const [isPublic, setIsPublic] = useState(true);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [maxAttendees, setMaxAttendees] = useState("");

  function updateTicket(index: number, field: keyof TicketDraft, value: unknown) {
    setTickets((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
    );
  }

  function addTicket() {
    setTickets((prev) => [...prev, { ...emptyTicket }]);
  }

  function removeTicket(index: number) {
    setTickets((prev) => prev.filter((_, i) => i !== index));
  }

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

  function validateStep(): boolean {
    setError("");
    if (step === 0) {
      if (!title.trim()) { setError("Le titre est requis"); return false; }
      if (title.trim().length < 3) { setError("Le titre doit faire au moins 3 caractères"); return false; }
      if (!description.trim()) { setError("La description est requise"); return false; }
      if (!startDate) { setError("La date de début est requise"); return false; }
      if (!endDate) { setError("La date de fin est requise"); return false; }
      if (new Date(endDate) <= new Date(startDate)) { setError("La date de fin doit être après la date de début"); return false; }
    }
    if (step === 1) {
      if (format !== "online") {
        if (!locationName.trim()) { setError("Le nom du lieu est requis"); return false; }
        if (!address.trim()) { setError("L'adresse est requise"); return false; }
        if (!city.trim()) { setError("La ville est requise"); return false; }
      }
      if ((format === "online" || format === "hybrid") && !streamUrl.trim()) {
        setError("Le lien du stream est requis pour un événement en ligne"); return false;
      }
    }
    if (step === 2) {
      if (tickets.length === 0) { setError("Ajoutez au moins un type de billet"); return false; }
      for (const t of tickets) {
        if (!t.name.trim()) { setError("Chaque billet doit avoir un nom"); return false; }
      }
    }
    return true;
  }

  function nextStep() {
    if (validateStep()) setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }

  function prevStep() {
    setStep((s) => Math.max(0, s - 1));
  }

  async function uploadCoverImage(eventId: string): Promise<string | undefined> {
    if (!coverImageFile) return undefined;

    try {
      const { data } = await uploadsApi.getEventSignedUrl(eventId, {
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

      return data.publicUrl;
    } catch {
      toast.error("Erreur lors du téléversement de l'image. L'événement a été créé sans image.");
      return undefined;
    }
  }

  async function handleSubmit() {
    if (!validateStep()) return;
    if (!user?.organizationId) {
      setError("Vous devez appartenir à une organisation pour créer un événement");
      return;
    }

    const dto: CreateEventDto = {
      organizationId: user.organizationId,
      title: title.trim(),
      description: description.trim(),
      shortDescription: shortDescription.trim() || undefined,
      category: category as CreateEventDto["category"],
      format: format as CreateEventDto["format"],
      status: "draft",
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(endDate).toISOString(),
      timezone: "Africa/Dakar",
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      location: {
        name: locationName.trim(),
        address: address.trim(),
        city: city.trim(),
        country,
        streamUrl: streamUrl.trim() || undefined,
      },
      venueId: venueId ?? undefined,
      accessZones: [],
      isFeatured: false,
      ticketTypes: tickets.map((t) => ({
        id: crypto.randomUUID(),
        name: t.name.trim(),
        description: t.description.trim() || undefined,
        price: t.price,
        currency: t.currency,
        totalQuantity: t.totalQuantity,
        soldCount: 0,
        isVisible: t.isVisible,
        accessZoneIds: [],
      })),
      isPublic,
      requiresApproval,
      maxAttendees: maxAttendees ? parseInt(maxAttendees, 10) : undefined,
    };

    setSubmitting(true);
    try {
      const result = await createEvent.mutateAsync(dto);
      const eventId = result.data.id;

      // Upload cover image after event creation (need eventId for signed URL)
      if (coverImageFile) {
        const coverUrl = await uploadCoverImage(eventId);
        if (coverUrl) {
          // Update event with cover image URL
          const { eventsApi } = await import("@/lib/api-client");
          await eventsApi.update(eventId, { coverImageURL: coverUrl } as any);
        }
      }

      router.push(`/events/${eventId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la création");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild><Link href="/">Tableau de bord</Link></BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild><Link href="/events">Événements</Link></BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Nouvel événement</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <h1 className="text-2xl font-bold text-foreground mb-6">Créer un événement</h1>

      {/* Step indicator */}
      <nav aria-label="Étapes de création d'événement" className="flex items-center gap-2 mb-8">
        <ol className="flex items-center gap-2 list-none p-0 m-0">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <button
                onClick={() => { if (i < step) setStep(i); }}
                disabled={i > step}
                aria-current={i === step ? "step" : undefined}
                aria-label={`${i < step ? "Terminé : " : ""}Étape ${i + 1} sur ${STEPS.length} : ${label}`}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  i === step
                    ? "bg-primary text-white"
                    : i < step
                    ? "bg-green-100 text-green-700 cursor-pointer"
                    : "bg-accent text-muted-foreground cursor-not-allowed"
                }`}
              >
                {i < step ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <span aria-hidden="true">{i + 1}</span>}
                {label}
              </button>
              {i < STEPS.length - 1 && <div className="w-8 h-px bg-border" aria-hidden="true" />}
            </li>
          ))}
        </ol>
      </nav>

      {error && (
        <div role="alert" className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">{error}</div>
      )}

      <div className="bg-card rounded-xl border border-border p-6">
        {/* Step 0: Details */}
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <label htmlFor="event-title" className="block text-sm font-medium text-foreground mb-1">
                Titre <span aria-hidden="true">*</span><span className="sr-only">(requis)</span>
              </label>
              <input
                id="event-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Dakar Tech Summit 2026"
                required
                aria-required="true"
                className="w-full px-4 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>

            {/* Cover Image Upload */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Image de couverture
              </label>
              {coverImagePreview ? (
                <div className="relative rounded-lg overflow-hidden border border-border">
                  <img
                    src={coverImagePreview}
                    alt="Aperçu de l'image de couverture"
                    className="w-full h-48 object-cover"
                  />
                  <button
                    type="button"
                    onClick={removeCoverImage}
                    className="absolute top-2 right-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
                    aria-label="Supprimer l'image de couverture"
                  >
                    <X className="h-4 w-4" />
                  </button>
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
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") coverInputRef.current?.click(); }}
                >
                  <ImagePlus className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Ajouter une image de couverture
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    JPG, PNG, WebP - max 10 Mo (optionnel)
                  </p>
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

            <div>
              <label htmlFor="event-description" className="block text-sm font-medium text-foreground mb-1">
                Description <span aria-hidden="true">*</span><span className="sr-only">(requis)</span>
              </label>
              <Textarea
                id="event-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Décrivez votre événement..."
                className="resize-none"
                required
                aria-required="true"
              />
            </div>
            <div>
              <label htmlFor="event-short-description" className="block text-sm font-medium text-foreground mb-1">Description courte</label>
              <input
                id="event-short-description"
                type="text"
                value={shortDescription}
                onChange={(e) => setShortDescription(e.target.value)}
                maxLength={300}
                placeholder="Résumé en une phrase (optionnel)"
                className="w-full px-4 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="event-category" className="block text-sm font-medium text-foreground mb-1">
                  Catégorie <span aria-hidden="true">*</span><span className="sr-only">(requis)</span>
                </label>
                <Select
                  id="event-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label htmlFor="event-format" className="block text-sm font-medium text-foreground mb-1">
                  Format <span aria-hidden="true">*</span><span className="sr-only">(requis)</span>
                </label>
                <Select
                  id="event-format"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  {FORMAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="event-start-date" className="block text-sm font-medium text-foreground mb-1">
                  Date de début <span aria-hidden="true">*</span><span className="sr-only">(requis)</span>
                </label>
                <input
                  id="event-start-date"
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                  aria-required="true"
                  className="w-full px-4 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
              <div>
                <label htmlFor="event-end-date" className="block text-sm font-medium text-foreground mb-1">
                  Date de fin <span aria-hidden="true">*</span><span className="sr-only">(requis)</span>
                </label>
                <input
                  id="event-end-date"
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                  aria-required="true"
                  className="w-full px-4 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
            </div>
            <div>
              <label htmlFor="event-tags" className="block text-sm font-medium text-foreground mb-1">Tags</label>
              <input
                id="event-tags"
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="tech, dakar, startup (séparés par des virgules)"
                className="w-full px-4 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
          </div>
        )}

        {/* Step 1: Location */}
        {step === 1 && (
          <div className="space-y-5">
            {format !== "online" && (
              <>
                {/* Venue selector */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    S\u00e9lectionner un lieu r\u00e9f\u00e9renc\u00e9
                  </label>
                  <VenueSelector
                    selectedVenueId={venueId}
                    selectedVenueName={venueName}
                    onSelect={(venue) => {
                      if (venue) {
                        setVenueId(venue.id);
                        setVenueName(venue.name);
                        setLocationName(venue.name);
                        setAddress(venue.address.street);
                        setCity(venue.address.city);
                        setCountry(venue.address.country);
                      } else {
                        setVenueId(null);
                        setVenueName(null);
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Choisissez un lieu existant ou saisissez manuellement ci-dessous
                  </p>
                </div>

                <div>
                  <label htmlFor="event-location-name" className="block text-sm font-medium text-foreground mb-1">
                    Nom du lieu <span aria-hidden="true">*</span><span className="sr-only">(requis)</span>
                  </label>
                  <input
                    id="event-location-name"
                    type="text"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    placeholder="Ex: Centre International de Conférences de Dakar"
                    required
                    aria-required="true"
                    className="w-full px-4 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
                <div>
                  <label htmlFor="event-address" className="block text-sm font-medium text-foreground mb-1">
                    Adresse <span aria-hidden="true">*</span><span className="sr-only">(requis)</span>
                  </label>
                  <input
                    id="event-address"
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Ex: Route de King Fahd, Almadies"
                    required
                    aria-required="true"
                    className="w-full px-4 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="event-city" className="block text-sm font-medium text-foreground mb-1">
                      Ville <span aria-hidden="true">*</span><span className="sr-only">(requis)</span>
                    </label>
                    <input
                      id="event-city"
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      required
                      aria-required="true"
                      className="w-full px-4 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                  <div>
                    <label htmlFor="event-country" className="block text-sm font-medium text-foreground mb-1">Pays</label>
                    <Select
                      id="event-country"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                    >
                      <option value="SN">Sénégal</option>
                      <option value="CI">Côte d&apos;Ivoire</option>
                      <option value="ML">Mali</option>
                      <option value="GN">Guinée</option>
                      <option value="BF">Burkina Faso</option>
                      <option value="BJ">Bénin</option>
                      <option value="TG">Togo</option>
                      <option value="NE">Niger</option>
                      <option value="CM">Cameroun</option>
                      <option value="GA">Gabon</option>
                    </Select>
                  </div>
                </div>
              </>
            )}
            {(format === "online" || format === "hybrid") && (
              <div>
                <label htmlFor="event-stream-url" className="block text-sm font-medium text-foreground mb-1">
                  Lien du stream <span aria-hidden="true">*</span><span className="sr-only">(requis)</span>
                </label>
                <input
                  id="event-stream-url"
                  type="url"
                  value={streamUrl}
                  onChange={(e) => setStreamUrl(e.target.value)}
                  placeholder="https://zoom.us/j/..."
                  required
                  aria-required="true"
                  className="w-full px-4 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
            )}
          </div>
        )}

        {/* Step 2: Tickets */}
        {step === 2 && (
          <div className="space-y-4">
            {tickets.map((ticket, i) => (
              <fieldset key={i} className="border border-border rounded-lg p-4 space-y-3">
                <legend className="text-sm font-medium text-foreground px-1">Billet #{i + 1}</legend>
                <div className="flex justify-end">
                  {tickets.length > 1 && (
                    <button
                      onClick={() => removeTicket(i)}
                      aria-label={`Supprimer le billet ${i + 1}`}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Supprimer
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={`ticket-name-${i}`} className="block text-xs text-muted-foreground mb-1">
                      Nom <span aria-hidden="true">*</span><span className="sr-only">(requis)</span>
                    </label>
                    <input
                      id={`ticket-name-${i}`}
                      type="text"
                      value={ticket.name}
                      onChange={(e) => updateTicket(i, "name", e.target.value)}
                      placeholder="Ex: VIP, Standard"
                      required
                      aria-required="true"
                      className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                  <div>
                    <label htmlFor={`ticket-price-${i}`} className="block text-xs text-muted-foreground mb-1">Prix (XOF)</label>
                    <input
                      id={`ticket-price-${i}`}
                      type="number"
                      min={0}
                      value={ticket.price}
                      onChange={(e) => updateTicket(i, "price", Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={`ticket-quantity-${i}`} className="block text-xs text-muted-foreground mb-1">Quantité (vide = illimité)</label>
                    <input
                      id={`ticket-quantity-${i}`}
                      type="number"
                      min={1}
                      value={ticket.totalQuantity ?? ""}
                      onChange={(e) => updateTicket(i, "totalQuantity", e.target.value ? Number(e.target.value) : null)}
                      placeholder="Illimité"
                      className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                  <div>
                    <label htmlFor={`ticket-description-${i}`} className="block text-xs text-muted-foreground mb-1">Description</label>
                    <input
                      id={`ticket-description-${i}`}
                      type="text"
                      value={ticket.description}
                      onChange={(e) => updateTicket(i, "description", e.target.value)}
                      placeholder="Optionnel"
                      className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                </div>
              </fieldset>
            ))}
            <button
              onClick={addTicket}
              className="w-full py-2.5 border-2 border-dashed border-border rounded-lg text-sm text-muted-foreground hover:border-muted-foreground hover:text-foreground transition-colors"
            >
              + Ajouter un type de billet
            </button>
          </div>
        )}

        {/* Step 3: Settings */}
        {step === 3 && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Événement public</p>
                <p className="text-xs text-muted-foreground">Visible dans la recherche publique</p>
              </div>
              <button
                onClick={() => setIsPublic(!isPublic)}
                role="switch"
                aria-checked={isPublic}
                aria-label="Événement public"
                className={`relative w-11 h-6 rounded-full transition-colors ${isPublic ? "bg-primary" : "bg-muted"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${isPublic ? "translate-x-5" : ""}`} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Approbation requise</p>
                <p className="text-xs text-muted-foreground">Les inscriptions doivent être approuvées manuellement</p>
              </div>
              <button
                onClick={() => setRequiresApproval(!requiresApproval)}
                role="switch"
                aria-checked={requiresApproval}
                aria-label="Approbation requise"
                className={`relative w-11 h-6 rounded-full transition-colors ${requiresApproval ? "bg-primary" : "bg-muted"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${requiresApproval ? "translate-x-5" : ""}`} />
              </button>
            </div>
            <div>
              <label htmlFor="event-max-attendees" className="block text-sm font-medium text-foreground mb-1">Nombre max de participants</label>
              <input
                id="event-max-attendees"
                type="number"
                min={1}
                value={maxAttendees}
                onChange={(e) => setMaxAttendees(e.target.value)}
                placeholder="Illimité"
                className="w-full px-4 py-2.5 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>

            {/* Review summary */}
            <div className="mt-6 border-t border-border pt-5">
              <h3 className="text-sm font-medium text-foreground mb-3">Récapitulatif</h3>
              <dl className="text-sm space-y-2">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Titre</dt>
                  <dd className="font-medium text-foreground">{title || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Catégorie</dt>
                  <dd className="text-foreground capitalize">{CATEGORY_OPTIONS.find((o) => o.value === category)?.label}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Format</dt>
                  <dd className="text-foreground">{FORMAT_OPTIONS.find((o) => o.value === format)?.label}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Lieu</dt>
                  <dd className="text-foreground">{city || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Billets</dt>
                  <dd className="text-foreground">{tickets.length} type{tickets.length > 1 ? "s" : ""}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Image de couverture</dt>
                  <dd className="text-foreground">{coverImageFile ? coverImageFile.name : "Aucune"}</dd>
                </div>
              </dl>
            </div>
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex justify-between mt-6">
        <button
          onClick={step === 0 ? () => router.push("/events") : prevStep}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {step === 0 ? "Annuler" : "Précédent"}
        </button>
        {step < STEPS.length - 1 ? (
          <button
            onClick={nextStep}
            className="inline-flex items-center gap-2 bg-primary text-white rounded-lg px-6 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Suivant <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 bg-primary text-white rounded-lg px-6 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Création en cours...</>
            ) : (
              <><Check className="h-4 w-4" /> Créer l&apos;événement</>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
