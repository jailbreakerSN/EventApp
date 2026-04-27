"use client";

import { useState } from "react";
import { parseAsString } from "nuqs";
import { PlanGate } from "@/components/plan/PlanGate";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  Badge,
  Button,
  Skeleton,
  Input,
  Select,
  ResultCount,
  PageSizeSelector,
  EmptyStateEditorial,
} from "@teranga/shared-ui";
import {
  QrCode,
  Download,
  Plus,
  Palette,
  FileText,
  Trash2,
  Pencil,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useEvents } from "@/hooks/use-events";
import {
  useBadgeTemplates,
  useCreateBadgeTemplate,
  useUpdateBadgeTemplate,
  useDeleteBadgeTemplate,
  useBulkGenerateBadges,
} from "@/hooks/use-badges";
import { useTableState } from "@/hooks/use-table-state";
import type { BadgeTemplate } from "@teranga/shared-types";
import { useTranslations } from "next-intl";

// ─── Constants ──────────────────────────────────────────────────────────────

const FIELD_VISIBILITY_OPTIONS = [
  { key: "showQR", label: "Code QR" },
  { key: "showName", label: "Nom" },
  { key: "showOrganization", label: "Organisation" },
  { key: "showRole", label: "Role" },
  { key: "showPhoto", label: "Photo" },
] as const;

// Doctrine-compliant data-listing wiring. Sortable fields mirror the
// closed Zod enum on `BadgeTemplateQuerySchema.orderBy` — adding a
// new value here without also extending the schema (and the composite
// indexes the audit script will require) is a compile-time mistake
// caught by tsc once the page references it.
const SORTABLE_FIELDS = ["name", "createdAt", "updatedAt"] as const;

const DEFAULT_FILTER_OPTIONS = [
  { value: "", label: "Tous les modèles" },
  { value: "true", label: "Modèles par défaut" },
  { value: "false", label: "Modèles personnalisés" },
] as const;

type Filters = { isDefault?: string };

// ─── Page ───────────────────────────────────────────────────────────────────

export default function BadgesPage() {
  const tCommon = useTranslations("common");
  void tCommon;
  const { user } = useAuth();
  const orgId = user?.organizationId;

  // Event selector
  const { data: eventsData, isLoading: eventsLoading } = useEvents();
  const events = eventsData?.data ?? [];
  const [selectedEventId, setSelectedEventId] = useState<string>("");

  // ── Data-listing doctrine — URL-backed search / filter / sort / page ──
  // The participant-facing /events bug taught us the cost of letting URL
  // params drift from the API contract. Here the hook owns one source
  // of truth (`urlNamespace="badges"`), the API enforces the same Zod
  // shape (BadgeTemplateQuerySchema), and the composite-index auditor
  // expands the orderBy enum so every reachable sort variant ships
  // with its required index.
  const t = useTableState<Filters>({
    urlNamespace: "badges",
    defaults: { sort: { field: "name", dir: "asc" }, pageSize: 25 },
    sortableFields: SORTABLE_FIELDS,
    filterParsers: { isDefault: parseAsString },
  });

  // Badge templates — paginated + filtered server-side via the new
  // BadgeTemplateQuery contract. The bulk-generate selector below the
  // grid still renders the same `templates` array, which intentionally
  // means the dropdown shows ONLY the page the user is currently viewing
  // (matches the operator's expectation: filter to find the template,
  // then generate against the visible match).
  const {
    data: templatesData,
    isLoading: templatesLoading,
    isError: templatesError,
  } = useBadgeTemplates(orgId, {
    q: t.debouncedQ || undefined,
    isDefault:
      t.filters.isDefault === "true"
        ? true
        : t.filters.isDefault === "false"
          ? false
          : undefined,
    page: t.page,
    limit: t.pageSize,
    orderBy: t.sort?.field as "name" | "createdAt" | "updatedAt" | undefined,
    orderDir: t.sort?.dir,
  });
  const templates: BadgeTemplate[] = templatesData?.data ?? [];
  const meta = templatesData?.meta ?? { page: 1, limit: t.pageSize, total: 0, totalPages: 1 };
  const hasActiveQueryOrFilters = !!t.q || t.activeFilterCount > 0;
  const isFilteredEmpty =
    !templatesLoading && !templatesError && templates.length === 0 && hasActiveQueryOrFilters;
  const isVirginEmpty =
    !templatesLoading && !templatesError && templates.length === 0 && !hasActiveQueryOrFilters;

  // Mutations
  const createTemplate = useCreateBadgeTemplate();
  const updateTemplate = useUpdateBadgeTemplate();
  const deleteTemplate = useDeleteBadgeTemplate();
  const bulkGenerate = useBulkGenerateBadges();

  // Create template form state
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formBgColor, setFormBgColor] = useState("#FFFFFF");
  const [formPrimaryColor, setFormPrimaryColor] = useState("#1A1A2E");
  const [formLogoURL, setFormLogoURL] = useState("");
  const [formShowQR, setFormShowQR] = useState(true);
  const [formShowName, setFormShowName] = useState(true);
  const [formShowOrganization, setFormShowOrganization] = useState(true);
  const [formShowRole, setFormShowRole] = useState(true);
  const [formShowPhoto, setFormShowPhoto] = useState(false);
  const [formIsDefault, setFormIsDefault] = useState(false);

  // Bulk generation state
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [bulkResult, setBulkResult] = useState<{ queued: number } | null>(null);

  const resetForm = () => {
    setFormName("");
    setFormBgColor("#FFFFFF");
    setFormPrimaryColor("#1A1A2E");
    setFormLogoURL("");
    setFormShowQR(true);
    setFormShowName(true);
    setFormShowOrganization(true);
    setFormShowRole(true);
    setFormShowPhoto(false);
    setFormIsDefault(false);
    setEditingId(null);
  };

  const openEditForm = (template: BadgeTemplate) => {
    setEditingId(template.id);
    setFormName(template.name);
    setFormBgColor(template.backgroundColor);
    setFormPrimaryColor(template.primaryColor);
    setFormLogoURL(template.logoURL ?? "");
    setFormShowQR(template.showQR);
    setFormShowName(template.showName);
    setFormShowOrganization(template.showOrganization);
    setFormShowRole(template.showRole);
    setFormShowPhoto(template.showPhoto);
    setFormIsDefault(template.isDefault);
    setShowCreate(true);
  };

  const handleCreateOrUpdate = async () => {
    if (!formName.trim() || !orgId) return;

    const payload = {
      name: formName.trim(),
      organizationId: orgId,
      width: 85.6,
      height: 54.0,
      backgroundColor: formBgColor,
      primaryColor: formPrimaryColor,
      logoURL: formLogoURL.trim() || null,
      showQR: formShowQR,
      showName: formShowName,
      showOrganization: formShowOrganization,
      showRole: formShowRole,
      showPhoto: formShowPhoto,
      isDefault: formIsDefault,
      customFields: [],
    };

    try {
      if (editingId) {
        const { organizationId: _orgId, ...updatePayload } = payload;
        await updateTemplate.mutateAsync({ templateId: editingId, dto: updatePayload });
        toast.success("Modèle mis à jour");
      } else {
        await createTemplate.mutateAsync(payload);
        toast.success("Modèle créé avec succès");
      }
      setShowCreate(false);
      resetForm();
    } catch {
      toast.error(editingId ? "Erreur lors de la mise a jour" : "Erreur lors de la creation");
    }
  };

  const handleDelete = async (templateId: string) => {
    try {
      await deleteTemplate.mutateAsync(templateId);
      toast.success("Modele supprime");
    } catch {
      toast.error("Erreur lors de la suppression");
    }
  };

  const handleBulkGenerate = async () => {
    if (!selectedEventId || !selectedTemplateId) {
      toast.error("Selectionnez un evenement et un modele");
      return;
    }
    try {
      setBulkResult(null);
      const result = await bulkGenerate.mutateAsync({
        eventId: selectedEventId,
        templateId: selectedTemplateId,
      });
      setBulkResult(result.data);
      toast.success(`${result.data.queued} badge(s) mis en file d'attente`);
    } catch {
      toast.error("Erreur lors de la génération des badges");
    }
  };

  const isFormBusy = createTemplate.isPending || updateTemplate.isPending;

  return (
    <div className="space-y-6">
      <PlanGate feature="customBadges" fallback="blur">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Badges & QR</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Créez des modèles de badge et générez les badges pour vos événements
            </p>
          </div>
          <Button
            onClick={() => {
              resetForm();
              setShowCreate(!showCreate);
            }}
            size="sm"
          >
            <Plus size={16} className="mr-1.5" />
            Creer un modele
          </Button>
        </div>

        {/* ─── Create / Edit Template Form ─────────────────────────────────────── */}
        {showCreate && (
          <Card>
            <CardContent className="p-6 space-y-4">
              <h3 className="font-semibold text-foreground">
                {editingId ? "Modifier le modele" : "Nouveau modele de badge"}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Nom du modele *
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    placeholder="Ex: Badge standard"
                  />
                </div>

                {/* Background color */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Couleur de fond
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={formBgColor}
                      onChange={(e) => setFormBgColor(e.target.value)}
                      className="h-9 w-12 rounded border border-border cursor-pointer"
                    />
                    <input
                      type="text"
                      value={formBgColor}
                      onChange={(e) => setFormBgColor(e.target.value)}
                      className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
                      placeholder="#FFFFFF"
                    />
                  </div>
                </div>

                {/* Primary color */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Couleur principale
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={formPrimaryColor}
                      onChange={(e) => setFormPrimaryColor(e.target.value)}
                      className="h-9 w-12 rounded border border-border cursor-pointer"
                    />
                    <input
                      type="text"
                      value={formPrimaryColor}
                      onChange={(e) => setFormPrimaryColor(e.target.value)}
                      className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
                      placeholder="#1A1A2E"
                    />
                  </div>
                </div>

                {/* Logo URL */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    URL du logo (optionnel)
                  </label>
                  <input
                    type="url"
                    value={formLogoURL}
                    onChange={(e) => setFormLogoURL(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    placeholder="https://example.com/logo.png"
                  />
                </div>
              </div>

              {/* Field visibility toggles */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Champs affiches
                </label>
                <div className="flex flex-wrap gap-3">
                  {FIELD_VISIBILITY_OPTIONS.map(({ key, label }) => {
                    const checked =
                      key === "showQR"
                        ? formShowQR
                        : key === "showName"
                          ? formShowName
                          : key === "showOrganization"
                            ? formShowOrganization
                            : key === "showRole"
                              ? formShowRole
                              : formShowPhoto;

                    const toggle = () => {
                      if (key === "showQR") setFormShowQR(!formShowQR);
                      else if (key === "showName") setFormShowName(!formShowName);
                      else if (key === "showOrganization")
                        setFormShowOrganization(!formShowOrganization);
                      else if (key === "showRole") setFormShowRole(!formShowRole);
                      else setFormShowPhoto(!formShowPhoto);
                    };

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={toggle}
                        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                          checked
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "bg-muted/50 border-border text-muted-foreground"
                        }`}
                        aria-label={`${checked ? "Masquer" : "Afficher"} ${label}`}
                      >
                        {checked ? <Eye size={13} /> : <EyeOff size={13} />}
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Default toggle */}
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={formIsDefault}
                  onChange={(e) => setFormIsDefault(e.target.checked)}
                  className="rounded border-border"
                />
                Modele par defaut pour l&apos;organisation
              </label>

              {/* Badge preview */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Apercu</label>
                <div
                  className="relative w-[340px] h-[215px] rounded-lg border border-border overflow-hidden shadow-sm"
                  style={{ backgroundColor: formBgColor }}
                >
                  {/* Header bar */}
                  <div
                    className="h-[30px] flex items-center px-3"
                    style={{ backgroundColor: formPrimaryColor }}
                  >
                    <span className="text-white text-[10px] font-bold truncate">
                      Nom de l&apos;evenement
                    </span>
                  </div>
                  {/* Content area */}
                  <div className="p-3 flex justify-between">
                    <div className="space-y-1">
                      {formShowName && (
                        <p className="text-sm font-bold" style={{ color: formPrimaryColor }}>
                          Prenom Nom
                        </p>
                      )}
                      {formShowOrganization && (
                        <p className="text-[10px]" style={{ color: formPrimaryColor }}>
                          Mon Organisation
                        </p>
                      )}
                      {formShowRole && (
                        <Badge variant="outline" className="text-[9px] mt-1">
                          Participant
                        </Badge>
                      )}
                    </div>
                    {formShowQR && (
                      <div className="w-16 h-16 bg-foreground/10 rounded flex items-center justify-center">
                        <QrCode size={40} className="text-foreground/40" />
                      </div>
                    )}
                  </div>
                  {formShowPhoto && (
                    <div className="absolute bottom-3 left-3 w-10 h-10 rounded-full bg-foreground/10 flex items-center justify-center">
                      <span className="text-[8px] text-muted-foreground">Photo</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <Button onClick={handleCreateOrUpdate} disabled={isFormBusy} size="sm">
                  {isFormBusy ? (
                    <>
                      <Loader2 size={14} className="mr-1.5 animate-spin" />
                      {editingId ? "Mise a jour..." : "Creation..."}
                    </>
                  ) : editingId ? (
                    "Mettre a jour"
                  ) : (
                    "Creer"
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowCreate(false);
                    resetForm();
                  }}
                  size="sm"
                >
                  Annuler
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── Templates Section ───────────────────────────────────────────────── */}
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
            <Palette size={18} />
            Modèles de badge
          </h2>

          {/* Toolbar — search + isDefault filter + sort + result count + clear-all.
              Layout mirrors /venues so operators get one consistent toolbar
              shape across the back-office (doctrine § Admin table — MUST). */}
          <div className="space-y-3 mb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative max-w-md flex-1">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  role="searchbox"
                  placeholder="Rechercher un modèle..."
                  value={t.q}
                  onChange={(e) => t.setQ(e.target.value)}
                  className="pl-9"
                  aria-label="Rechercher des modèles de badge"
                />
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <ResultCount total={meta.total} loading={templatesLoading} />
                <PageSizeSelector value={t.pageSize} onChange={t.setPageSize} />
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                <span>Type</span>
                <Select
                  value={t.filters.isDefault ?? ""}
                  onChange={(e) => t.setFilter("isDefault", e.target.value || undefined)}
                  aria-label="Filtrer par type de modèle"
                >
                  {DEFAULT_FILTER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                <span>Trier par</span>
                <Select
                  value={`${t.sort?.field ?? "name"}:${t.sort?.dir ?? "asc"}`}
                  onChange={(e) => {
                    // useTableState exposes only `toggleSort(field)` — to set
                    // a specific (field, dir) pair from a Select we either
                    // toggle once (default asc) or twice (flip to desc).
                    // Same pattern lives in /venues; lifting it into a
                    // useTableState helper is a follow-up.
                    const [field, dir] = e.target.value.split(":") as [
                      (typeof SORTABLE_FIELDS)[number],
                      "asc" | "desc",
                    ];
                    if (t.sort?.field !== field) {
                      t.toggleSort(field);
                      if (dir === "desc") t.toggleSort(field);
                    } else if (t.sort.dir !== dir) {
                      t.toggleSort(field);
                    }
                  }}
                  aria-label="Trier les modèles"
                >
                  <option value="name:asc">Nom (A → Z)</option>
                  <option value="name:desc">Nom (Z → A)</option>
                  <option value="createdAt:desc">Récemment ajoutés</option>
                  <option value="createdAt:asc">Anciens d&apos;abord</option>
                  <option value="updatedAt:desc">Récemment modifiés</option>
                </Select>
              </label>
              {hasActiveQueryOrFilters ? (
                <button
                  type="button"
                  onClick={t.reset}
                  className="self-end text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                >
                  Tout effacer
                </button>
              ) : null}
            </div>
          </div>

          {/* Loading */}
          {templatesLoading && (
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
          {templatesError && (
            <Card>
              <CardContent className="p-6 text-center">
                <AlertCircle size={32} className="mx-auto text-destructive/50 mb-2" />
                <p className="text-destructive text-sm">Erreur lors du chargement des modèles</p>
              </CardContent>
            </Card>
          )}

          {/* Empty — virgin (no templates ever) → onboarding CTA */}
          {isVirginEmpty && (
            <EmptyStateEditorial
              icon={FileText}
              kicker="— AUCUN MODÈLE"
              title="Démarrez votre catalogue de badges"
              description="Créez votre premier modèle pour générer des badges personnalisés pour vos événements."
              action={
                <Button
                  onClick={() => {
                    resetForm();
                    setShowCreate(true);
                  }}
                  size="sm"
                >
                  <Plus size={16} className="mr-1.5" />
                  Créer un modèle
                </Button>
              }
            />
          )}

          {/* Empty — filtered (has templates but none match) → clear filters */}
          {isFilteredEmpty && (
            <EmptyStateEditorial
              icon={Search}
              kicker="— AUCUN RÉSULTAT"
              title="Aucun modèle ne correspond à votre recherche"
              description="Modifiez votre requête ou réinitialisez les filtres pour voir tous les modèles."
              action={
                <button
                  type="button"
                  onClick={t.reset}
                  className="text-sm font-medium text-teranga-gold-dark hover:underline"
                >
                  Effacer les filtres
                </button>
              }
            />
          )}

          {/* Template cards — only when there's at least one match. */}
          {!templatesLoading && !templatesError && templates.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map((template) => (
                <Card key={template.id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="p-5">
                    {/* Color preview strip */}
                    <div className="flex gap-2 mb-3">
                      <div
                        className="w-8 h-8 rounded border border-border"
                        style={{ backgroundColor: template.backgroundColor }}
                        title="Couleur de fond"
                      />
                      <div
                        className="w-8 h-8 rounded border border-border"
                        style={{ backgroundColor: template.primaryColor }}
                        title="Couleur principale"
                      />
                    </div>

                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground truncate">{template.name}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {template.width}mm x {template.height}mm
                        </p>
                      </div>
                      {template.isDefault && (
                        <Badge variant="success" className="ml-2 shrink-0 text-[10px]">
                          Par defaut
                        </Badge>
                      )}
                    </div>

                    {/* Visible fields */}
                    <div className="flex flex-wrap gap-1 mt-2 mb-3">
                      {template.showQR && (
                        <Badge variant="outline" className="text-[9px]">
                          QR
                        </Badge>
                      )}
                      {template.showName && (
                        <Badge variant="outline" className="text-[9px]">
                          Nom
                        </Badge>
                      )}
                      {template.showOrganization && (
                        <Badge variant="outline" className="text-[9px]">
                          Org
                        </Badge>
                      )}
                      {template.showRole && (
                        <Badge variant="outline" className="text-[9px]">
                          Role
                        </Badge>
                      )}
                      {template.showPhoto && (
                        <Badge variant="outline" className="text-[9px]">
                          Photo
                        </Badge>
                      )}
                    </div>

                    <p className="text-[10px] text-muted-foreground">
                      Modifie le {new Date(template.updatedAt).toLocaleDateString("fr-SN")}
                    </p>

                    {/* Actions */}
                    <div className="flex gap-1.5 mt-3 pt-3 border-t border-border">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditForm(template)}
                        className="text-xs"
                      >
                        <Pencil size={12} className="mr-1" />
                        Modifier
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(template.id)}
                        disabled={deleteTemplate.isPending}
                        className="text-xs text-destructive hover:text-destructive"
                      >
                        <Trash2 size={12} className="mr-1" />
                        Supprimer
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Pagination — page-numbered for the bounded admin table archetype.
              Prev/Next disabled at bounds; aria-current on the active page;
              hidden when only one page exists so the toolbar isn't noisy on
              freshly-onboarded orgs. */}
          {!templatesLoading && !templatesError && templates.length > 0 && meta.totalPages > 1 && (
            <nav
              aria-label="Pagination des modèles de badge"
              className="mt-6 flex items-center justify-between gap-3"
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => t.setPage(t.page - 1)}
                disabled={t.page <= 1}
                aria-label="Page précédente"
              >
                <ChevronLeft size={14} className="mr-1" />
                Précédent
              </Button>
              <span aria-current="page" className="text-sm text-muted-foreground">
                Page {meta.page} sur {meta.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => t.setPage(t.page + 1)}
                disabled={t.page >= meta.totalPages}
                aria-label="Page suivante"
              >
                Suivant
                <ChevronRight size={14} className="ml-1" />
              </Button>
            </nav>
          )}
        </div>

        {/* ─── Badge Generation Section ────────────────────────────────────────── */}
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
            <QrCode size={18} />
            Generation des badges
          </h2>

          <Card>
            <CardContent className="p-6 space-y-4">
              {/* Event selector */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Evenement
                  </label>
                  <select
                    value={selectedEventId}
                    onChange={(e) => {
                      setSelectedEventId(e.target.value);
                      setBulkResult(null);
                    }}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    disabled={eventsLoading}
                  >
                    <option value="">{eventsLoading ? "…" : "Selectionnez un evenement"}</option>
                    {events.map((event: { id: string; title: string }) => (
                      <option key={event.id} value={event.id}>
                        {event.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Modele de badge
                  </label>
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => {
                      setSelectedTemplateId(e.target.value);
                      setBulkResult(null);
                    }}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    disabled={templatesLoading || templates.length === 0}
                  >
                    <option value="">
                      {templatesLoading
                        ? "…"
                        : templates.length === 0
                          ? "Aucun modele disponible"
                          : "Selectionnez un modele"}
                    </option>
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name} {tpl.isDefault ? "(par defaut)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* No event selected hint */}
              {!selectedEventId && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md p-3">
                  <AlertCircle size={16} />
                  Selectionnez un evenement et un modele pour generer les badges de tous les
                  participants confirmes.
                </div>
              )}

              {/* Generate button */}
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleBulkGenerate}
                  disabled={!selectedEventId || !selectedTemplateId || bulkGenerate.isPending}
                  size="sm"
                >
                  {bulkGenerate.isPending ? (
                    <>
                      <Loader2 size={14} className="mr-1.5 animate-spin" />
                      Generation en cours...
                    </>
                  ) : (
                    <>
                      <Download size={14} className="mr-1.5" />
                      Generer les badges
                    </>
                  )}
                </Button>
              </div>

              {/* Bulk result */}
              {bulkResult && (
                <div className="flex items-center gap-2 text-sm bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 rounded-md p-3">
                  <CheckCircle2 size={16} />
                  {bulkResult.queued > 0
                    ? `${bulkResult.queued} badge(s) mis en file d'attente pour generation. Les PDF seront disponibles sous peu.`
                    : "Tous les badges ont deja ete generes pour cet evenement."}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </PlanGate>
    </div>
  );
}
