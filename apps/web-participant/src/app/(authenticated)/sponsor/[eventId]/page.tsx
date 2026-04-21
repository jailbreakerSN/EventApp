"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { sponsorsApi } from "@/lib/api-client";
import { toast } from "sonner";
import {
  Building,
  Edit3,
  Save,
  Download,
  Users,
  ExternalLink,
  Mail,
  Phone,
  Tag,
  BarChart3,
  Eye,
  TrendingUp,
  Info,
  ArrowLeft,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import type { SponsorProfile } from "@teranga/shared-types";
import {
  Skeleton,
  DataTable,
  EmptyStateEditorial,
  type DataTableColumn,
} from "@teranga/shared-ui";

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
  const [tab, setTab] = useState<"analytics" | "booth" | "leads">("analytics");

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
      setBoothTitle(mySponsor.boothTitle ?? "");
      setCtaLabel(mySponsor.ctaLabel ?? "");
      setCtaUrl(mySponsor.ctaUrl ?? "");
      setWebsiteEdit(mySponsor.website ?? "");

      // Load leads
      try {
        const leadsResult = await sponsorsApi.getLeads(mySponsor.id);
        setLeads(leadsResult.data ?? []);
      } catch {
        // Leads may not be available
      }
    } catch {
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
        boothTitle: boothTitle || null,
        ctaLabel: ctaLabel || null,
        ctaUrl: ctaUrl || null,
      });
      setEditing(false);
      await loadData();
    } catch {
      toast.error("Erreur lors de l'enregistrement. Veuillez réessayer.");
    } finally {
      setSaving(false);
    }
  }

  async function handleExportCSV() {
    if (!sponsor) return;
    try {
      // API returns JSON array of lead objects. Convert to CSV client-
      // side — previously this code assumed the API returned CSV text
      // directly and produced a `[object Object]` download because
      // `result.data` was an object array, not a string.
      const result = await sponsorsApi.exportLeads(sponsor.id);
      const leads = result.data;
      const header = ["id", "name", "email", "phone", "notes", "tags", "scannedAt"];
      const escapeCsv = (v: unknown): string => {
        const s = v == null ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const rows = leads.map((l) =>
        [
          escapeCsv(l.id),
          escapeCsv(l.name),
          escapeCsv(l.email),
          escapeCsv(l.phone),
          escapeCsv(l.notes),
          escapeCsv((l.tags ?? []).join("|")),
          escapeCsv(l.scannedAt),
        ].join(","),
      );
      const csvContent = [header.join(","), ...rows].join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `leads-${sponsor.companyName.toLowerCase().replace(/\s+/g, "-")}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      toast.error("Erreur lors de l'export CSV. Veuillez réessayer.");
    }
  }

  if (loading) {
    return (
      <div
        className="mx-auto max-w-3xl px-4 py-8 space-y-6"
        role="status"
        aria-label="Chargement du portail sponsor"
      >
        <div className="space-y-3">
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
        </div>
        <div className="bg-card rounded-xl border border-border p-6 space-y-3">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-card rounded-xl border border-border p-4 space-y-2">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-6 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !sponsor) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyStateEditorial
          icon={AlertTriangle}
          kicker="— INTROUVABLE"
          title={error ?? "Profil introuvable."}
        />
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
      <Link
        href="/my-events"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Mes événements
      </Link>
      <div className="flex items-center gap-4">
        {sponsor.logoURL ? (
          <img
            src={sponsor.logoURL}
            alt={sponsor.companyName}
            className="h-14 w-14 rounded-lg object-contain"
          />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-teranga-navy">
            <Building className="h-7 w-7 text-teranga-gold" />
          </div>
        )}
        <div>
          <h1 className="font-serif-display text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-foreground">
            {sponsor.companyName}
          </h1>
          <span className="inline-flex items-center rounded-full bg-teranga-gold/10 px-2.5 py-0.5 text-xs font-medium text-teranga-gold">
            {TIER_LABELS[sponsor.tier] ?? sponsor.tier}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="mt-6 flex gap-1 border-b"
        role="tablist"
        aria-label="Sections du portail sponsor"
      >
        {(["analytics", "booth", "leads"] as const).map((t) => {
          const labels: Record<typeof t, string> = {
            analytics: "Analytiques",
            booth: "Mon stand",
            leads: `Leads (${leads.length})`,
          };
          return (
            <button
              key={t}
              role="tab"
              onClick={() => setTab(t)}
              aria-selected={tab === t}
              aria-controls={`tab-panel-${t}`}
              id={`tab-${t}`}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? "border-teranga-gold text-teranga-gold"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {labels[t]}
            </button>
          );
        })}
      </div>

      {/* Analytics Tab */}
      {tab === "analytics" && <SponsorAnalytics leads={leads} />}

      {/* Booth Tab */}
      {tab === "booth" && (
        <section
          id="tab-panel-booth"
          role="tabpanel"
          aria-labelledby="tab-booth"
          className="mt-6 rounded-lg border bg-card p-6 shadow-sm"
        >
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
                <label
                  htmlFor="sponsor-description"
                  className="text-sm font-medium text-muted-foreground"
                >
                  Description
                </label>
                <textarea
                  id="sponsor-description"
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Décrivez votre entreprise et vos produits..."
                />
              </div>
              <div>
                <label
                  htmlFor="sponsor-booth-title"
                  className="text-sm font-medium text-muted-foreground"
                >
                  Titre du stand
                </label>
                <input
                  id="sponsor-booth-title"
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={boothTitle}
                  onChange={(e) => setBoothTitle(e.target.value)}
                  placeholder="Ex: Découvrez nos solutions cloud"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="sponsor-cta-label"
                    className="text-sm font-medium text-muted-foreground"
                  >
                    Label du CTA
                  </label>
                  <input
                    id="sponsor-cta-label"
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    value={ctaLabel}
                    onChange={(e) => setCtaLabel(e.target.value)}
                    placeholder="Demander une démo"
                  />
                </div>
                <div>
                  <label
                    htmlFor="sponsor-cta-url"
                    className="text-sm font-medium text-muted-foreground"
                  >
                    URL du CTA
                  </label>
                  <input
                    id="sponsor-cta-url"
                    className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    value={ctaUrl}
                    onChange={(e) => setCtaUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="sponsor-website"
                  className="text-sm font-medium text-muted-foreground"
                >
                  Site web
                </label>
                <input
                  id="sponsor-website"
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
                <p className="text-sm text-muted-foreground whitespace-pre-line">
                  {sponsor.description}
                </p>
              )}
              {sponsor.boothTitle && (
                <div>
                  <p className="text-xs font-medium uppercase text-muted-foreground">Stand</p>
                  <p className="font-medium">{sponsor.boothTitle}</p>
                </div>
              )}
              {sponsor.ctaLabel && sponsor.ctaUrl && (
                <a
                  href={sponsor.ctaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-teranga-gold px-4 py-2 text-sm font-medium text-white hover:bg-teranga-gold/90"
                >
                  {sponsor.ctaLabel} <ExternalLink className="h-3.5 w-3.5" />
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
        <section id="tab-panel-leads" role="tabpanel" aria-labelledby="tab-leads" className="mt-6">
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
                <Download className="h-4 w-4" aria-hidden="true" /> Exporter CSV
              </button>
            )}
          </div>

          {leads.length === 0 ? (
            <EmptyStateEditorial
              icon={Users}
              kicker="— AUCUN LEAD"
              title="Aucun lead collecté pour le moment"
              description="Les leads apparaîtront ici quand les participants scanneront votre QR code."
            />
          ) : (
            <DataTable<Lead & Record<string, unknown>>
              aria-label="Leads collectés"
              emptyMessage="Aucun lead pour le moment"
              responsiveCards
              data={leads as (Lead & Record<string, unknown>)[]}
              columns={
                [
                  {
                    key: "name",
                    header: "Nom",
                    primary: true,
                    render: (lead) => <span className="font-medium">{lead.name}</span>,
                  },
                  {
                    key: "contact",
                    header: "Contact",
                    render: (lead) => (
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
                    ),
                  },
                  {
                    key: "tags",
                    header: "Tags",
                    hideOnMobile: true,
                    render: (lead) => (
                      <div className="flex flex-wrap gap-1">
                        {lead.tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-xs"
                          >
                            <Tag className="h-2.5 w-2.5" /> {tag}
                          </span>
                        ))}
                      </div>
                    ),
                  },
                  {
                    key: "notes",
                    header: "Notes",
                    hideOnMobile: true,
                    render: (lead) => (
                      <span className="text-xs text-muted-foreground max-w-[200px] truncate inline-block">
                        {lead.notes ?? "—"}
                      </span>
                    ),
                  },
                  {
                    key: "scannedAt",
                    header: "Scanné le",
                    render: (lead) => (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(lead.scannedAt).toLocaleString("fr-FR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </span>
                    ),
                  },
                ] as DataTableColumn<Lead & Record<string, unknown>>[]
              }
            />
          )}
        </section>
      )}
    </div>
  );
}

/* ── Sponsor Analytics Component ── */

function SponsorAnalytics({ leads }: { leads: Lead[] }) {
  // Compute KPIs
  const leadsCount = leads.length;
  // Simulated visits: roughly 3x the leads (visitors who saw the booth but didn't scan)
  const visitsCount = leadsCount > 0 ? leadsCount * 3 + Math.floor(leadsCount * 0.4) : 0;
  const conversionRate = visitsCount > 0 ? ((leadsCount / visitsCount) * 100).toFixed(1) : "0.0";

  // Compute leads per day for bar chart
  const leadsPerDay: Record<string, number> = {};
  for (const lead of leads) {
    const day = new Date(lead.scannedAt).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
    });
    leadsPerDay[day] = (leadsPerDay[day] ?? 0) + 1;
  }
  const dayEntries = Object.entries(leadsPerDay);
  const maxPerDay = Math.max(...dayEntries.map(([, count]) => count), 1);

  return (
    <section
      id="tab-panel-analytics"
      role="tabpanel"
      aria-labelledby="tab-analytics"
      className="mt-6 space-y-6"
    >
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-teranga-gold/10 p-2">
              <Users className="h-5 w-5 text-teranga-gold" />
            </div>
            <p className="text-sm text-muted-foreground">Leads collectés</p>
          </div>
          <p className="text-3xl font-bold text-foreground">{leadsCount}</p>
        </div>
        <div className="rounded-lg border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-blue-100 dark:bg-blue-900/20 p-2">
              <Eye className="h-5 w-5 text-blue-600" />
            </div>
            <p className="text-sm text-muted-foreground">Visites stand</p>
          </div>
          <p className="text-3xl font-bold text-foreground">{visitsCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Estimation</p>
        </div>
        <div className="rounded-lg border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-green-100 dark:bg-green-900/20 p-2">
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
            <p className="text-sm text-muted-foreground">Taux de conversion</p>
          </div>
          <p className="text-3xl font-bold text-foreground">{conversionRate}%</p>
        </div>
      </div>

      {/* Real-time data notice */}
      <div className="flex items-start gap-2 rounded-lg border border-teranga-gold/30 bg-teranga-gold/5 px-4 py-3">
        <Info className="h-4 w-4 text-teranga-gold mt-0.5 shrink-0" />
        <p className="text-sm text-muted-foreground">
          Données en temps réel bientôt disponibles. Les visites stand sont actuellement une
          estimation basée sur le nombre de leads.
        </p>
      </div>

      {/* Leads per day bar chart */}
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-5 w-5 text-teranga-gold" />
          <h3 className="text-sm font-semibold text-foreground">Leads par jour</h3>
        </div>

        {dayEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Aucune donnée à afficher pour le moment.
          </p>
        ) : (
          <div className="space-y-3">
            {dayEntries.map(([day, count]) => {
              const widthPercent = (count / maxPerDay) * 100;
              return (
                <div key={day} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-16 shrink-0 text-right">
                    {day}
                  </span>
                  <div className="flex-1 h-7 bg-muted/50 rounded-md overflow-hidden">
                    <div
                      className="h-full bg-teranga-gold/80 rounded-md flex items-center justify-end px-2 transition-all duration-300"
                      style={{ width: `${Math.max(widthPercent, 8)}%` }}
                    >
                      <span className="text-xs font-medium text-white">{count}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
