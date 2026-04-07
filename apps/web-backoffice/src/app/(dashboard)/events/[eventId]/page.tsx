"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  useEvent,
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
} from "@/hooks/use-registrations";
import { formatDate, formatCurrency } from "@/lib/utils";
import {
  ArrowLeft,
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
} from "lucide-react";
import Link from "next/link";
import { useAddAccessZone, useRemoveAccessZone } from "@/hooks/use-access-zones";
import { useSessions, useCreateSession, useDeleteSession } from "@/hooks/use-sessions";
import { useFeedPosts, useCreateFeedPost, useDeleteFeedPost, useTogglePin } from "@/hooks/use-feed";
import { eventsApi } from "@/lib/api-client";
import type { Event, CreateTicketTypeDto, CreateAccessZoneDto, Session as SessionType, CreateSessionDto } from "@teranga/shared-types";
import { Calendar, MessageSquare, Clock, Mic } from "lucide-react";

const TABS = ["Infos", "Billets", "Inscriptions", "Sessions", "Feed", "Zones"] as const;
type Tab = (typeof TABS)[number];

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  draft: { label: "Brouillon", className: "bg-gray-100 text-gray-700" },
  published: { label: "Publié", className: "bg-green-100 text-green-700" },
  cancelled: { label: "Annulé", className: "bg-red-100 text-red-700" },
  archived: { label: "Archivé", className: "bg-yellow-100 text-yellow-700" },
  completed: { label: "Terminé", className: "bg-blue-100 text-blue-700" },
};

const REG_STATUS: Record<string, { label: string; className: string }> = {
  confirmed: { label: "Confirmé", className: "bg-green-100 text-green-700" },
  pending: { label: "En attente", className: "bg-yellow-100 text-yellow-700" },
  waitlisted: { label: "Liste d'attente", className: "bg-blue-100 text-blue-700" },
  cancelled: { label: "Annulé", className: "bg-red-100 text-red-700" },
  checked_in: { label: "Entré", className: "bg-purple-100 text-purple-700" },
};

export default function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Infos");

  const { data, isLoading, isError } = useEvent(eventId);
  const event = data?.data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Chargement...
      </div>
    );
  }

  if (isError || !event) {
    return (
      <div className="text-center py-20">
        <p className="text-red-500 mb-4">Événement introuvable ou erreur de chargement.</p>
        <button onClick={() => router.push("/events")} className="text-sm text-[#1A1A2E] hover:underline">
          Retour aux événements
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => router.push("/events")}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Événements
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-gray-900">{event.title}</h1>
            <StatusBadge status={event.status} />
          </div>
          <p className="text-sm text-gray-500">
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
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-[#1A1A2E] text-[#1A1A2E]"
                : "border-transparent text-gray-400 hover:text-gray-600"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Infos" && <InfoTab event={event} />}
      {tab === "Billets" && <TicketsTab event={event} />}
      {tab === "Inscriptions" && <RegistrationsTab eventId={eventId} />}
      {tab === "Sessions" && <SessionsTab eventId={eventId} eventStatus={event.status} />}
      {tab === "Feed" && <FeedTab eventId={eventId} />}
      {tab === "Zones" && <AccessZonesTab event={event} />}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? STATUS_LABELS.draft;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.className}`}>
      {s.label}
    </span>
  );
}

function EventActions({ event }: { event: Event }) {
  const router = useRouter();
  const publish = usePublishEvent();
  const unpublish = useUnpublishEvent();
  const cancel = useCancelEvent();
  const [cloning, setCloning] = useState(false);

  const handleClone = async () => {
    setCloning(true);
    try {
      // Set new dates 1 month from now
      const now = new Date();
      const newStart = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate(), 9, 0);
      const newEnd = new Date(newStart.getTime() + (new Date(event.endDate).getTime() - new Date(event.startDate).getTime()));
      const result = await eventsApi.clone(event.id, {
        newStartDate: newStart.toISOString(),
        newEndDate: newEnd.toISOString(),
        copyTicketTypes: true,
        copyAccessZones: true,
      });
      router.push(`/events/${result.data.id}`);
    } finally {
      setCloning(false);
    }
  };

  return (
    <div className="flex gap-2">
      <button
        onClick={handleClone}
        disabled={cloning}
        className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-600 rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
      >
        <Copy className="h-4 w-4" />
        {cloning ? "Duplication..." : "Dupliquer"}
      </button>
      {event.status === "draft" && (
        <button
          onClick={() => publish.mutate(event.id)}
          disabled={publish.isPending}
          className="inline-flex items-center gap-1.5 bg-green-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
        >
          <Globe className="h-4 w-4" />
          {publish.isPending ? "Publication..." : "Publier"}
        </button>
      )}
      {event.status === "published" && (
        <button
          onClick={() => unpublish.mutate(event.id)}
          disabled={unpublish.isPending}
          className="inline-flex items-center gap-1.5 bg-yellow-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-yellow-700 disabled:opacity-50"
        >
          <GlobeLock className="h-4 w-4" />
          {unpublish.isPending ? "..." : "Dépublier"}
        </button>
      )}
      {(event.status === "draft" || event.status === "published") && (
        <button
          onClick={() => {
            if (confirm("Êtes-vous sûr de vouloir annuler cet événement ?")) {
              cancel.mutate(event.id);
            }
          }}
          disabled={cancel.isPending}
          className="inline-flex items-center gap-1.5 border border-red-200 text-red-600 rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-50 disabled:opacity-50"
        >
          <XCircle className="h-4 w-4" />
          Annuler
        </button>
      )}
    </div>
  );
}

function InfoTab({ event }: { event: Event }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h3 className="text-sm font-medium text-gray-500 mb-3 flex items-center gap-2">
            <Info className="h-4 w-4" /> Description
          </h3>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{event.description}</p>
        </div>
        {event.shortDescription && (
          <div className="bg-white rounded-xl border border-gray-100 p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Description courte</h3>
            <p className="text-sm text-gray-700">{event.shortDescription}</p>
          </div>
        )}
      </div>
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-3">Détails</h3>
          <dl className="text-sm space-y-3">
            <Field label="Catégorie" value={event.category} />
            <Field label="Format" value={event.format === "in_person" ? "Présentiel" : event.format === "online" ? "En ligne" : "Hybride"} />
            <Field label="Début" value={formatDate(event.startDate)} />
            <Field label="Fin" value={formatDate(event.endDate)} />
            <Field label="Fuseau" value={event.timezone} />
            {event.isPublic !== undefined && <Field label="Public" value={event.isPublic ? "Oui" : "Non"} />}
            {event.requiresApproval && <Field label="Approbation" value="Requise" />}
          </dl>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-3">Lieu</h3>
          <dl className="text-sm space-y-2">
            <Field label="Nom" value={event.location?.name} />
            <Field label="Adresse" value={event.location?.address} />
            <Field label="Ville" value={event.location?.city} />
            <Field label="Pays" value={event.location?.country} />
          </dl>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-3">Statistiques</h3>
          <dl className="text-sm space-y-3">
            <Field label="Inscrits" value={String(event.registeredCount ?? 0)} />
            <Field label="Check-ins" value={String(event.checkedInCount ?? 0)} />
            {event.maxAttendees && <Field label="Capacité max" value={String(event.maxAttendees)} />}
          </dl>
        </div>
        {event.tags && event.tags.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="text-sm font-medium text-gray-500 mb-3">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {event.tags.map((tag) => (
                <span key={tag} className="bg-gray-100 text-gray-600 text-xs px-2.5 py-1 rounded-full">{tag}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-400">{label}</dt>
      <dd className="text-gray-900 font-medium">{value || "—"}</dd>
    </div>
  );
}

function TicketsTab({ event }: { event: Event }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState(0);
  const [newQty, setNewQty] = useState("");
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
      onSuccess: () => { setShowAdd(false); setNewName(""); setNewPrice(0); setNewQty(""); },
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-500 flex items-center gap-2">
          <Ticket className="h-4 w-4" /> {event.ticketTypes?.length ?? 0} type(s) de billet
        </h3>
        {event.status === "draft" && (
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="inline-flex items-center gap-1.5 text-sm text-[#1A1A2E] hover:underline font-medium"
          >
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        )}
      </div>

      {showAdd && (
        <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <input
              type="text"
              placeholder="Nom du billet"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20"
            />
            <input
              type="number"
              min={0}
              placeholder="Prix (XOF)"
              value={newPrice}
              onChange={(e) => setNewPrice(Number(e.target.value))}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20"
            />
            <input
              type="number"
              min={1}
              placeholder="Quantité (vide = illimité)"
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={addTicket.isPending}
              className="bg-[#1A1A2E] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#16213E] disabled:opacity-50"
            >
              {addTicket.isPending ? "Ajout..." : "Ajouter le billet"}
            </button>
            <button onClick={() => setShowAdd(false)} className="text-sm text-gray-500 hover:text-gray-700">
              Annuler
            </button>
          </div>
        </div>
      )}

      {(!event.ticketTypes || event.ticketTypes.length === 0) ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400">
          Aucun type de billet configuré.
        </div>
      ) : (
        <div className="space-y-3">
          {event.ticketTypes.map((tt) => (
            <div key={tt.id} className="bg-white rounded-xl border border-gray-100 p-5 flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">{tt.name}</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  {tt.price === 0 ? "Gratuit" : formatCurrency(tt.price, tt.currency)} · {tt.soldCount}/{tt.totalQuantity ?? "∞"} vendus
                  {!tt.isVisible && " · Masqué"}
                </p>
              </div>
              {event.status === "draft" && (
                <button
                  onClick={() => {
                    if (confirm(`Supprimer le billet "${tt.name}" ?`)) {
                      removeTicket.mutate(tt.id);
                    }
                  }}
                  className="text-red-400 hover:text-red-600 p-1"
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

  const registrations = data?.data ?? [];
  const meta = data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-500 flex items-center gap-2">
          <Users className="h-4 w-4" /> {meta?.total ?? 0} inscription(s)
        </h3>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none"
        >
          <option value="">Tous les statuts</option>
          <option value="confirmed">Confirmé</option>
          <option value="pending">En attente</option>
          <option value="waitlisted">Liste d&apos;attente</option>
          <option value="cancelled">Annulé</option>
          <option value="checked_in">Entré</option>
        </select>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400">
          Chargement...
        </div>
      ) : registrations.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400">
          Aucune inscription pour le moment.
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500 font-medium">
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
                  const status = REG_STATUS[reg.status] ?? REG_STATUS.pending;
                  return (
                    <tr key={reg.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-6 py-3 text-gray-400 font-mono text-xs">{reg.id.slice(0, 8)}</td>
                      <td className="px-6 py-3 text-gray-900">{reg.userId.slice(0, 12)}...</td>
                      <td className="px-6 py-3 text-gray-600">{reg.ticketTypeId.slice(0, 8)}</td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-gray-500 text-xs">{formatDate(reg.createdAt)}</td>
                      <td className="px-6 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {reg.status === "pending" && (
                            <button
                              onClick={() => approve.mutate(reg.id)}
                              disabled={approve.isPending}
                              className="text-green-600 hover:text-green-800 p-1"
                              title="Approuver"
                            >
                              <CheckCircle className="h-4 w-4" />
                            </button>
                          )}
                          {(reg.status === "pending" || reg.status === "confirmed") && (
                            <button
                              onClick={() => cancelReg.mutate(reg.id)}
                              disabled={cancelReg.isPending}
                              className="text-red-400 hover:text-red-600 p-1"
                              title="Annuler"
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
            <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
              <span>Page {page} sur {totalPages}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
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
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
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
        <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nom</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Zone VIP"
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Couleur</label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-full h-9 rounded-lg border cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Capacite (optionnel)</label>
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
              className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-100"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {event.accessZones.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <MapPin className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>Aucune zone d'acces configuree</p>
          <p className="text-sm mt-1">Les zones permettent de controler l'entree par secteur</p>
        </div>
      ) : (
        <div className="space-y-3">
          {event.accessZones.map((zone) => (
            <div key={zone.id} className="bg-white border rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: zone.color }} />
                <div>
                  <span className="font-medium text-gray-900">{zone.name}</span>
                  {zone.capacity && (
                    <span className="text-sm text-gray-500 ml-2">Capacite: {zone.capacity}</span>
                  )}
                </div>
              </div>
              {event.status === "draft" && (
                <button
                  onClick={() => removeZone.mutate(zone.id)}
                  disabled={removeZone.isPending}
                  className="p-2 rounded-lg text-red-500 hover:bg-red-50"
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
    await createSession.mutateAsync(dto);
    setTitle(""); setDesc(""); setSessionLoc(""); setStartTime(""); setEndTime("");
    setShowForm(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-500 flex items-center gap-2">
          <Calendar className="h-4 w-4" /> {sessions.length} session(s)
        </h3>
        {(eventStatus === "draft" || eventStatus === "published") && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="inline-flex items-center gap-1.5 text-sm text-[#1A1A2E] hover:underline font-medium"
          >
            <Plus className="h-4 w-4" /> Ajouter
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Titre</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Keynote d'ouverture"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Début</label>
              <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fin</label>
              <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Salle / Lieu</label>
              <input type="text" value={sessionLoc} onChange={(e) => setSessionLoc(e.target.value)}
                placeholder="Ex: Salle A"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd}
              disabled={createSession.isPending || !title.trim() || !startTime || !endTime}
              className="bg-[#1A1A2E] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#16213E] disabled:opacity-50">
              {createSession.isPending ? "Ajout..." : "Ajouter la session"}
            </button>
            <button onClick={() => setShowForm(false)} className="text-sm text-gray-500 hover:text-gray-700">Annuler</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400">Chargement...</div>
      ) : sessions.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400">
          <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>Aucune session programmée</p>
          <p className="text-sm mt-1">Ajoutez des sessions pour construire l&apos;agenda</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div key={session.id} className="bg-white rounded-xl border border-gray-100 p-5 flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium text-gray-900">{session.title}</p>
                  {session.location && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{session.location}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {formatDate(session.startTime)} — {formatDate(session.endTime)}
                  </span>
                  {session.speakerIds.length > 0 && (
                    <span className="flex items-center gap-1"><Mic className="h-3 w-3" /> {session.speakerIds.length} intervenant(s)</span>
                  )}
                </div>
                {session.description && <p className="text-sm text-gray-500 mt-2 line-clamp-2">{session.description}</p>}
              </div>
              <button
                onClick={() => { if (confirm(`Supprimer la session "${session.title}" ?`)) deleteSession.mutate(session.id); }}
                className="text-red-400 hover:text-red-600 p-1 ml-3">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
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

  const posts = data?.data ?? [];

  const handlePost = async () => {
    if (!content.trim()) return;
    await createPost.mutateAsync({ content: content.trim(), isAnnouncement });
    setContent(""); setIsAnnouncement(false);
  };

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-500 flex items-center gap-2 mb-4">
        <MessageSquare className="h-4 w-4" /> Feed de l&apos;événement
      </h3>

      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <textarea value={content} onChange={(e) => setContent(e.target.value)}
          placeholder="Publier une mise à jour..." rows={3}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A1A2E]/20 mb-3" />
        <div className="flex items-center justify-between">
          <label className="inline-flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={isAnnouncement} onChange={(e) => setIsAnnouncement(e.target.checked)} className="rounded border-gray-300" />
            Annonce (notification à tous)
          </label>
          <button onClick={handlePost} disabled={createPost.isPending || !content.trim()}
            className="bg-[#1A1A2E] text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-[#16213E] disabled:opacity-50">
            {createPost.isPending ? "Publication..." : "Publier"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-gray-400">Chargement...</div>
      ) : posts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400">
          <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>Aucune publication</p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <div key={post.id} className={`bg-white rounded-xl border p-5 ${post.isPinned ? "border-amber-200 bg-amber-50/30" : "border-gray-100"}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-gray-900">{post.authorName}</span>
                    <span className="text-xs text-gray-400">{formatDate(post.createdAt)}</span>
                    {post.isAnnouncement && <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">Annonce</span>}
                    {post.isPinned && <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full">Épinglé</span>}
                  </div>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{post.content}</p>
                  <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                    <span>{post.likeCount} j&apos;aime</span>
                    <span>{post.commentCount} commentaire(s)</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-3">
                  <button onClick={() => togglePin.mutate(post.id)}
                    className={`p-1.5 rounded-lg text-xs ${post.isPinned ? "text-amber-600 hover:bg-amber-50" : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"}`}
                    title={post.isPinned ? "Désépingler" : "Épingler"}>
                    Pin
                  </button>
                  <button onClick={() => { if (confirm("Supprimer cette publication ?")) deletePost.mutate(post.id); }}
                    className="text-red-400 hover:text-red-600 p-1.5">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
