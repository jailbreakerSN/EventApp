"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCreateEvent } from "@/hooks/use-events";
import { useAuth } from "@/hooks/use-auth";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import type { CreateEventDto } from "@teranga/shared-types";

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
  const router = useRouter();
  const { user } = useAuth();
  const createEvent = useCreateEvent();
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");

  // Step 1: Details
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [category, setCategory] = useState("conference");
  const [format, setFormat] = useState("in_person");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [tags, setTags] = useState("");

  // Step 2: Location
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

    try {
      const result = await createEvent.mutateAsync(dto);
      router.push(`/events/${result.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la création");
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <button
        onClick={() => router.push("/events")}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Retour aux événements
      </button>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Créer un événement</h1>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <button
              onClick={() => { if (i < step) setStep(i); }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                i === step
                  ? "bg-[#1A1A2E] text-white"
                  : i < step
                  ? "bg-green-100 text-green-700 cursor-pointer"
                  : "bg-gray-100 text-gray-400"
              }`}
            >
              {i < step ? <Check className="h-3.5 w-3.5" /> : <span>{i + 1}</span>}
              {label}
            </button>
            {i < STEPS.length - 1 && <div className="w-8 h-px bg-gray-200" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 p-6">
        {/* Step 0: Details */}
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Titre *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Dakar Tech Summit 2026"
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Décrivez votre événement..."
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E] resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description courte</label>
              <input
                type="text"
                value={shortDescription}
                onChange={(e) => setShortDescription(e.target.value)}
                maxLength={300}
                placeholder="Résumé en une phrase (optionnel)"
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E]"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie *</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E]"
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Format *</label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E]"
                >
                  {FORMAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date de début *</label>
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date de fin *</label>
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E]"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="tech, dakar, startup (séparés par des virgules)"
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E]"
              />
            </div>
          </div>
        )}

        {/* Step 1: Location */}
        {step === 1 && (
          <div className="space-y-5">
            {format !== "online" && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nom du lieu *</label>
                  <input
                    type="text"
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    placeholder="Ex: Centre International de Conférences de Dakar"
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Adresse *</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Ex: Route de King Fahd, Almadies"
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Ville *</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Pays</label>
                    <select
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E]"
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
                    </select>
                  </div>
                </div>
              </>
            )}
            {(format === "online" || format === "hybrid") && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Lien du stream *</label>
                <input
                  type="url"
                  value={streamUrl}
                  onChange={(e) => setStreamUrl(e.target.value)}
                  placeholder="https://zoom.us/j/..."
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E]"
                />
              </div>
            )}
          </div>
        )}

        {/* Step 2: Tickets */}
        {step === 2 && (
          <div className="space-y-4">
            {tickets.map((ticket, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Billet #{i + 1}</span>
                  {tickets.length > 1 && (
                    <button
                      onClick={() => removeTicket(i)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Supprimer
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Nom *</label>
                    <input
                      type="text"
                      value={ticket.name}
                      onChange={(e) => updateTicket(i, "name", e.target.value)}
                      placeholder="Ex: VIP, Standard"
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Prix (XOF)</label>
                    <input
                      type="number"
                      min={0}
                      value={ticket.price}
                      onChange={(e) => updateTicket(i, "price", Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E]"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Quantité (vide = illimité)</label>
                    <input
                      type="number"
                      min={1}
                      value={ticket.totalQuantity ?? ""}
                      onChange={(e) => updateTicket(i, "totalQuantity", e.target.value ? Number(e.target.value) : null)}
                      placeholder="Illimité"
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Description</label>
                    <input
                      type="text"
                      value={ticket.description}
                      onChange={(e) => updateTicket(i, "description", e.target.value)}
                      placeholder="Optionnel"
                      className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E]"
                    />
                  </div>
                </div>
              </div>
            ))}
            <button
              onClick={addTicket}
              className="w-full py-2.5 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
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
                <p className="text-sm font-medium text-gray-700">Événement public</p>
                <p className="text-xs text-gray-400">Visible dans la recherche publique</p>
              </div>
              <button
                onClick={() => setIsPublic(!isPublic)}
                role="switch"
                aria-checked={isPublic}
                aria-label="Événement public"
                className={`relative w-11 h-6 rounded-full transition-colors ${isPublic ? "bg-[#1A1A2E]" : "bg-gray-200"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${isPublic ? "translate-x-5" : ""}`} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">Approbation requise</p>
                <p className="text-xs text-gray-400">Les inscriptions doivent être approuvées manuellement</p>
              </div>
              <button
                onClick={() => setRequiresApproval(!requiresApproval)}
                role="switch"
                aria-checked={requiresApproval}
                aria-label="Approbation requise"
                className={`relative w-11 h-6 rounded-full transition-colors ${requiresApproval ? "bg-[#1A1A2E]" : "bg-gray-200"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${requiresApproval ? "translate-x-5" : ""}`} />
              </button>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre max de participants</label>
              <input
                type="number"
                min={1}
                value={maxAttendees}
                onChange={(e) => setMaxAttendees(e.target.value)}
                placeholder="Illimité"
                className="w-full px-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 focus:border-[#1A1A2E]"
              />
            </div>

            {/* Review summary */}
            <div className="mt-6 border-t border-gray-100 pt-5">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Récapitulatif</h3>
              <dl className="text-sm space-y-2">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Titre</dt>
                  <dd className="font-medium text-gray-900">{title || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Catégorie</dt>
                  <dd className="text-gray-900 capitalize">{CATEGORY_OPTIONS.find((o) => o.value === category)?.label}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Format</dt>
                  <dd className="text-gray-900">{FORMAT_OPTIONS.find((o) => o.value === format)?.label}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Lieu</dt>
                  <dd className="text-gray-900">{city || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Billets</dt>
                  <dd className="text-gray-900">{tickets.length} type{tickets.length > 1 ? "s" : ""}</dd>
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
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {step === 0 ? "Annuler" : "Précédent"}
        </button>
        {step < STEPS.length - 1 ? (
          <button
            onClick={nextStep}
            className="inline-flex items-center gap-2 bg-[#1A1A2E] text-white rounded-lg px-6 py-2.5 text-sm font-semibold hover:bg-[#16213E] transition-colors"
          >
            Suivant <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={createEvent.isPending}
            className="inline-flex items-center gap-2 bg-[#1A1A2E] text-white rounded-lg px-6 py-2.5 text-sm font-semibold hover:bg-[#16213E] transition-colors disabled:opacity-50"
          >
            {createEvent.isPending ? (
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
