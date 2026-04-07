"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { sponsorsApi } from "@/lib/api-client";
import {
  Building,
  Edit3,
  Save,
  Loader2,
  Download,
  Users,
  ExternalLink,
  Mail,
  Phone,
  Tag,
} from "lucide-react";
import type { SponsorProfile } from "@teranga/shared-types";

interface Lead {
  id: string;
  name: string;
  email: string;
  phone?: string;
  notes?: string;
  tags: string[];
  scannedAt: string;
}

export default function SponsorPortalPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [sponsor, setSponsor] = useState<SponsorProfile | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"booth" | "leads">("booth");

  // Edit form state
  const [description, setDescription] = useState("");
  const [boothTitle, setBoothTitle] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [websiteEdit, setWebsiteEdit] = useState("");

  useEffect(() => {
    loadData();
  }, [eventId]);

  async function loadData() {
    try {
      setLoading(true);
      const sponsorsResult = await sponsorsApi.list(eventId);
      const mySponsor = sponsorsResult.data?.[0];
      if (!mySponsor) {
        setError("Profil de sponsor introuvable pour cet événement.");
        return;
      }
      setSponsor(mySponsor);
      setDescription(mySponsor.description ?? "");
      setBoothTitle(mySponsor.boothInfo?.title ?? "");
      setCtaLabel(mySponsor.boothInfo?.ctaLabel ?? "");
      setCtaUrl(mySponsor.boothInfo?.ctaUrl ?? "");
      setWebsiteEdit(mySponsor.website ?? "");

      // Load leads
      try {
        const leadsResult = await sponsorsApi.getLeads(mySponsor.id);
        setLeads(leadsResult.data ?? []);
      } catch {
        // Leads may not be available
      }
    } catch (err) {
      setError("Erreur de chargement. Vérifiez que vous avez accès à cet événement.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!sponsor) return;
    setSaving(true);
    try {
      await sponsorsApi.update(sponsor.id, {
        description,
        website: websiteEdit || undefined,
        boothInfo: {
          ...(sponsor.boothInfo ?? {}),
          title: boothTitle || undefined,
          ctaLabel: ctaLabel || undefined,
          ctaUrl: ctaUrl || undefined,
        },
      } as Partial<SponsorProfile>);
      setEditing(false);
      await loadData();
    } catch {
      // Error handled silently
    } finally {
      setSaving(false);
    }
  }

  async function handleExportCSV() {
    if (!sponsor) return;
    try {
      const result = await sponsorsApi.exportLeads(sponsor.id);
      const csvContent = result.data;
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `leads-${sponsor.companyName.toLowerCase().replace(/\s+/g, "-")}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      // Export error
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Chargement...
      </div>
    );
  }

  if (error || !sponsor) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-destructive">{error ?? "Profil introuvable."}</p>
      </div>
    );
  }

  const TIER_LABELS: Record<string, string> = {
    platinum: "Platine",
    gold: "Or",
    silver: "Argent",
    bronze: "Bronze",
    partner: "Partenaire",
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="flex items-center gap-4">
        {sponsor.logoURL ? (
          <img src={sponsor.logoURL} alt={sponsor.companyName} className="h-14 w-14 rounded-lg object-contain" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-teranga-navy">
            <Building className="h-7 w-7 text-teranga-gold" />
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold text-foreground">{sponsor.companyName}</h1>
          <span className="inline-flex items-center rounded-full bg-teranga-gold/10 px-2.5 py-0.5 text-xs font-medium text-teranga-gold">
            {TIER_LABELS[sponsor.tier] ?? sponsor.tier}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-1 border-b">
        {(["booth", "leads"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-teranga-gold text-teranga-gold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "booth" ? "Mon stand" : `Leads (${leads.length})`}
          </button>
        ))}
      </div>

      {/* Booth Tab */}
      {tab === "booth" && (
        <section className="mt-6 rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Informations du stand</h2>
            {!editing ? (
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 text-sm text-teranga-gold hover:underline"
              >
                <Edit3 className="h-4 w-4" /> Modifier
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-md bg-teranga-gold px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  <Save className="h-4 w-4" /> {saving ? "Enregistrement..." : "Enregistrer"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-md border px-3 py-1.5 text-sm"
                >
                  Annuler
                </button>
              </div>
            )}
          </div>

          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Description</label>
                <textarea
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Décrivez votre entreprise et vos produits..."
                />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Titre du stand</label>
                <input
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={boothTitle}
                  onChange={(e) => setBoothTitle(e.target.value)}
                  placeholder="Ex: Découvrez nos solutions cloud"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Label du CTA</label>
                  <input
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    value={ctaLabel}
                    onChange={(e) => setCtaLabel(e.target.value)}
                    placeholder="Demander une démo"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">URL du CTA</label>
                  <input
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    value={ctaUrl}
                    onChange={(e) => setCtaUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Site web</label>
                <input
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={websiteEdit}
                  onChange={(e) => setWebsiteEdit(e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {sponsor.description && (
                <p className="text-sm text-muted-foreground whitespace-pre-line">{sponsor.description}</p>
              )}
              {sponsor.boothInfo?.title && (
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">Stand</p>
                  <p className="font-medium">{sponsor.boothInfo.title}</p>
                </div>
              )}
              {sponsor.boothInfo?.ctaLabel && sponsor.boothInfo?.ctaUrl && (
                <a
                  href={sponsor.boothInfo.ctaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-teranga-gold px-4 py-2 text-sm font-medium text-white hover:bg-teranga-gold/90"
                >
                  {sponsor.boothInfo.ctaLabel} <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {sponsor.website && (
                <a
                  href={sponsor.website}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-sm text-teranga-gold hover:underline"
                >
                  {sponsor.website}
                </a>
              )}
            </div>
          )}
        </section>
      )}

      {/* Leads Tab */}
      {tab === "leads" && (
        <section className="mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">
              <Users className="inline h-5 w-5 mr-1.5 text-teranga-gold" />
              Leads collectés ({leads.length})
            </h2>
            {leads.length > 0 && (
              <button
                onClick={handleExportCSV}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                <Download className="h-4 w-4" /> Exporter CSV
              </button>
            )}
          </div>

          {leads.length === 0 ? (
            <div className="rounded-lg border bg-card p-8 text-center shadow-sm">
              <Users className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                Aucun lead collecté pour le moment.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Les leads apparaîtront ici quand les participants scanneront votre QR code.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nom</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Contact</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tags</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Notes</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Scanné le</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {leads.map((lead) => (
                    <tr key={lead.id}>
                      <td className="px-4 py-3 font-medium">{lead.name}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="flex items-center gap-1 text-xs">
                            <Mail className="h-3 w-3" /> {lead.email}
                          </span>
                          {lead.phone && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Phone className="h-3 w-3" /> {lead.phone}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {lead.tags.map((tag) => (
                            <span key={tag} className="inline-flex items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-xs">
                              <Tag className="h-2.5 w-2.5" /> {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate">
                        {lead.notes ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(lead.scannedAt).toLocaleString("fr-FR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
