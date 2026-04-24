"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  CreatePlanSchema,
  EntitlementMapSchema,
  PLAN_LIMIT_UNLIMITED,
  type CreatePlanDto,
  type EntitlementMap,
  type Plan,
  type PlanFeatures,
  type PreviewChangeResponse,
  type PricingModel,
} from "@teranga/shared-types";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Select,
  Switch,
  Textarea,
} from "@teranga/shared-ui";
import { AlertTriangle, Info, Lock } from "lucide-react";
import { toast } from "sonner";
import { useCreatePlan, usePreviewPlanChange, useUpdatePlan } from "@/hooks/use-admin";

// ─── Constants ────────────────────────────────────────────────────────────

const FEATURE_LABELS: Record<keyof PlanFeatures, { fr: string; hint?: string }> = {
  qrScanning: { fr: "Scan QR" },
  paidTickets: { fr: "Billets payants", hint: "Autorise la création de billets à prix > 0" },
  customBadges: { fr: "Badges personnalisés" },
  csvExport: { fr: "Export CSV" },
  smsNotifications: { fr: "Notifications SMS" },
  advancedAnalytics: { fr: "Analytics avancées" },
  speakerPortal: { fr: "Portail intervenants" },
  sponsorPortal: { fr: "Portail sponsors" },
  apiAccess: { fr: "Accès API" },
  whiteLabel: { fr: "Marque blanche" },
  promoCodes: { fr: "Codes promo" },
};

const DEFAULT_FEATURES: PlanFeatures = {
  qrScanning: false,
  paidTickets: false,
  customBadges: false,
  csvExport: false,
  smsNotifications: false,
  advancedAnalytics: false,
  speakerPortal: false,
  sponsorPortal: false,
  apiAccess: false,
  whiteLabel: false,
  promoCodes: false,
};

// ─── Types ────────────────────────────────────────────────────────────────

export interface PlanFormProps {
  mode: "create" | "edit";
  plan?: Plan;
}

// Shape the RHF sees — we reuse CreatePlanSchema for the create path, and the
// edit path uses the same shape (all fields present). UpdatePlanSchema's
// `partial()` is enforced by the API, not the UI.
type PlanFormValues = CreatePlanDto & {
  description: { fr: string; en: string } | null;
};

// RHF number-input coercers. `valueAsNumber: true` emits NaN when the
// input is momentarily empty (mid-edit backspace), which JSON-serialises
// to `null` and trips the server's `z.number()` validation with a 400.
// These helpers keep the form state as a finite number (or null, for
// nullable fields) at all times.
function numberOrZero(v: unknown): number {
  if (v === "" || v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function numberOrNull(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─── Component ────────────────────────────────────────────────────────────

export function PlanForm({ mode, plan }: PlanFormProps) {
  const router = useRouter();
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();
  const isSystem = plan?.isSystem ?? false;
  const isBusy = createPlan.isPending || updatePlan.isPending;

  const defaultValues = useMemo<PlanFormValues>(() => {
    if (plan) {
      return {
        key: plan.key,
        name: plan.name,
        description: plan.description ?? null,
        // Fallback for legacy plan docs without the field (pre-pricingModel).
        pricingModel: plan.pricingModel ?? (plan.priceXof > 0 ? "fixed" : "free"),
        priceXof: plan.priceXof,
        annualPriceXof: plan.annualPriceXof ?? 0,
        limits: plan.limits,
        features: plan.features,
        isPublic: plan.isPublic,
        sortOrder: plan.sortOrder,
        trialDays: plan.trialDays ?? 0,
      };
    }
    return {
      key: "",
      name: { fr: "", en: "" },
      description: null,
      pricingModel: "fixed" as PricingModel,
      priceXof: 9900,
      annualPriceXof: 0,
      limits: {
        maxEvents: 3,
        maxParticipantsPerEvent: 50,
        maxMembers: 1,
      },
      features: DEFAULT_FEATURES,
      isPublic: true,
      sortOrder: 100,
      trialDays: 0,
    };
  }, [plan]);

  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<PlanFormValues>({
    resolver: zodResolver(CreatePlanSchema),
    defaultValues,
    mode: "onBlur",
  });

  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  // ── Phase 7+ item #2 — entitlements editor (MVP) ───────────────────────
  // Entitlements is a free-form `Record<string, Entitlement>` blob that
  // doesn't fit cleanly into react-hook-form's per-field registration
  // model. We keep it out of RHF, hold the JSON text as local state,
  // validate against EntitlementMapSchema on every keystroke, and track
  // a `dirty` flag so the server only sees the field when the admin
  // actually edited it (review finding M1: without the dirty flag, an
  // unrelated "Save" on a plan that gained entitlements between mount
  // and submit would silently wipe them by PATCH-ing `entitlements: null`).
  const serializePlanEntitlements = (p: Plan | undefined): string =>
    p?.entitlements && Object.keys(p.entitlements).length > 0
      ? JSON.stringify(p.entitlements, null, 2)
      : "";
  const [entitlementsJson, setEntitlementsJson] = useState<string>(
    serializePlanEntitlements(plan),
  );
  const [entitlementsDirty, setEntitlementsDirty] = useState<boolean>(false);
  const [entitlementsError, setEntitlementsError] = useState<string | null>(null);

  // Re-seed when the plan prop changes (e.g. after a router navigation or
  // a React Query refetch). Mirrors the `reset(defaultValues)` pattern the
  // RHF fields use.
  useEffect(() => {
    setEntitlementsJson(serializePlanEntitlements(plan));
    setEntitlementsDirty(false);
  }, [plan]);
  const parsedEntitlements = useMemo<{
    value: EntitlementMap | undefined;
    hasKeys: boolean;
  }>(() => {
    const trimmed = entitlementsJson.trim();
    if (!trimmed) {
      return { value: undefined, hasKeys: false };
    }
    try {
      const parsed = JSON.parse(trimmed);
      const result = EntitlementMapSchema.safeParse(parsed);
      if (!result.success) {
        return { value: undefined, hasKeys: true };
      }
      return { value: result.data, hasKeys: Object.keys(result.data).length > 0 };
    } catch {
      return { value: undefined, hasKeys: true };
    }
  }, [entitlementsJson]);

  useEffect(() => {
    const trimmed = entitlementsJson.trim();
    if (!trimmed) {
      setEntitlementsError(null);
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      const result = EntitlementMapSchema.safeParse(parsed);
      if (!result.success) {
        const first = result.error.errors[0];
        setEntitlementsError(
          first ? `${first.path.join(".")}: ${first.message}` : "JSON invalide",
        );
      } else {
        setEntitlementsError(null);
      }
    } catch (err) {
      setEntitlementsError(
        `JSON malformé : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [entitlementsJson]);

  const entitlementsOverrideActive = parsedEntitlements.hasKeys && parsedEntitlements.value;

  // ── Phase 7+ item #6 — dry-run / impact preview ────────────────────────
  // Whenever the form becomes dirty on an existing plan, debounce a call
  // to the preview endpoint so the impact banner reflects the CURRENT
  // form state. We watch a focused subset of version-material fields to
  // avoid re-running on display-only nudges (sortOrder / isPublic).
  const previewPlan = usePreviewPlanChange();
  const [preview, setPreview] = useState<PreviewChangeResponse | null>(null);
  const watchedPrice = watch("priceXof");
  const watchedAnnual = watch("annualPriceXof");
  const watchedLimits = watch("limits");
  const watchedFeatures = watch("features");
  const watchedTrial = watch("trialDays");
  useEffect(() => {
    if (mode !== "edit" || !plan || !isDirty) {
      setPreview(null);
      return;
    }
    // Defensive guard: skip the preview call if any numeric field is
    // non-finite (e.g. NaN from a half-edited input). The server's
    // Zod schema rejects non-numbers with a 400 — previewing an
    // intermediate form state would spam the endpoint with errors the
    // user can't act on. The preview is advisory; waiting for a valid
    // form state before firing is the right UX.
    const isValidLimit = (v: number | undefined) =>
      typeof v === "number" && Number.isFinite(v) && Number.isInteger(v);
    const limitsValid =
      watchedLimits &&
      isValidLimit(watchedLimits.maxEvents) &&
      isValidLimit(watchedLimits.maxParticipantsPerEvent) &&
      isValidLimit(watchedLimits.maxMembers);
    const priceValid = isValidLimit(watchedPrice);
    const annualValid = watchedAnnual == null || isValidLimit(watchedAnnual);
    const trialValid = watchedTrial == null || isValidLimit(watchedTrial);
    if (!limitsValid || !priceValid || !annualValid || !trialValid) {
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await previewPlan.mutateAsync({
          planId: plan.id,
          dto: {
            priceXof: watchedPrice,
            annualPriceXof: watchedAnnual ?? null,
            limits: watchedLimits,
            features: watchedFeatures,
            trialDays: watchedTrial ?? null,
          },
        });
        setPreview(res.data);
      } catch {
        // Silent: the UI only treats preview as advisory. The save
        // button still works even if the preview fails.
        setPreview(null);
      }
    }, 500);
    return () => clearTimeout(timer);
    // previewPlan.mutateAsync is stable; deliberately omitted from deps.
  }, [
    mode,
    plan,
    isDirty,
    watchedPrice,
    watchedAnnual,
    watchedLimits,
    watchedFeatures,
    watchedTrial,
    previewPlan,
  ]);

  const onSubmit = async (data: PlanFormValues) => {
    // Phase 7+ item #2 — block submit if the entitlements JSON is
    // present but malformed. Empty textarea = undefined (legacy path,
    // allowed).
    if (entitlementsJson.trim() && entitlementsError) {
      toast.error("Le JSON des entitlements est invalide");
      return;
    }

    try {
      // Normalize description: empty strings → null so the server doesn't get
      // a Zod min(1) violation on both fr/en.
      const description =
        data.description && (data.description.fr || data.description.en) ? data.description : null;

      // "free" and "custom" plans ignore priceXof by contract; normalize
      // so we don't persist stale values that the server-side refinement
      // would reject (free + priceXof>0).
      const normalizedPriceXof =
        data.pricingModel === "free" || data.pricingModel === "custom" ? 0 : data.priceXof;
      // Annual price is only meaningful for "fixed" plans with priceXof > 0.
      // `null` is the explicit "monthly only" signal the server expects.
      const normalizedAnnualPriceXof =
        data.pricingModel !== "fixed" || !data.annualPriceXof ? null : data.annualPriceXof;

      if (mode === "create") {
        await createPlan.mutateAsync({
          ...data,
          description,
          priceXof: normalizedPriceXof,
          annualPriceXof: normalizedAnnualPriceXof,
          // Phase 7+ item #2 — optional on CreatePlanSchema; omit when
          // empty so a blank create stays on the legacy path.
          ...(parsedEntitlements.value ? { entitlements: parsedEntitlements.value } : {}),
        });
        toast.success("Plan créé");
        router.push("/admin/plans");
      } else if (plan) {
        // UpdatePlanSchema is partial — still send the full shape, the server
        // accepts any subset.
        //
        // Phase 7+ item #2 — entitlements is nullable on UpdatePlanSchema:
        //   - populated map  → replace with this map
        //   - null           → clear the map (revert to legacy path)
        //   - undefined      → don't touch the existing field
        //
        // Send `entitlements` ONLY when the admin actually edited the
        // textarea (dirty flag). Review finding M1: without the dirty
        // guard, a Save click on a plan that received entitlements
        // between mount and submit — e.g. another admin edited them in
        // parallel and a React Query refetch brought them in — would
        // PATCH `entitlements: null` and silently clear them.
        const entitlementsPatch: Partial<{ entitlements: EntitlementMap | null }> =
          entitlementsDirty
            ? { entitlements: parsedEntitlements.value ?? null }
            : {};
        await updatePlan.mutateAsync({
          planId: plan.id,
          dto: {
            name: data.name,
            description,
            pricingModel: data.pricingModel,
            priceXof: normalizedPriceXof,
            annualPriceXof: normalizedAnnualPriceXof,
            limits: data.limits,
            features: data.features,
            ...entitlementsPatch,
            isPublic: data.isPublic,
            sortOrder: data.sortOrder,
            trialDays: data.trialDays ?? null,
          },
        });
        toast.success("Plan mis à jour");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Une erreur est survenue";
      toast.error(msg);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Phase 7+ item #6 — impact preview banner. Renders when the admin
          has made a version-material edit and the server's dry-run found
          at least one affected subscriber. Advisory only: the Save button
          is never blocked by it. */}
      {preview && preview.willMintNewVersion && preview.totalScanned > 0 && (
        <div
          role="status"
          className={
            preview.totalAffected > 0
              ? "flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"
              : "flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm"
          }
        >
          {preview.totalAffected > 0 ? (
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0 text-destructive"
              aria-hidden="true"
            />
          ) : (
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          )}
          <div className="space-y-2">
            <p className="font-medium text-foreground">
              {preview.totalAffected > 0
                ? `${preview.totalAffected} organisation${preview.totalAffected > 1 ? "s" : ""} sur ${preview.totalScanned} ser${preview.totalAffected > 1 ? "ont" : "a"} impactée${preview.totalAffected > 1 ? "s" : ""} par cette modification`
                : `${preview.totalScanned} organisation${preview.totalScanned > 1 ? "s abonnées" : " abonnée"} — aucune ne dépasse les nouvelles limites`}
            </p>
            {preview.totalAffected > 0 && (
              <ul className="space-y-1.5 text-muted-foreground">
                {preview.affected
                  .filter((a) => a.violations.length > 0)
                  .slice(0, 5)
                  .map((a) => (
                    <li key={a.orgId} className="text-xs">
                      <span className="font-medium text-foreground">{a.name}</span>
                      <span className="mx-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        v{a.currentVersion}
                      </span>
                      {a.isTrialing && (
                        <span className="mr-1.5 rounded-full bg-teranga-gold/15 px-1.5 py-0.5 text-[10px] font-medium text-teranga-gold">
                          essai
                        </span>
                      )}
                      {a.billingCycle === "annual" && (
                        <span className="mr-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          annuel
                        </span>
                      )}
                      <span>— {a.violations.join(", ")}</span>
                    </li>
                  ))}
                {preview.totalAffected > 5 && (
                  <li className="text-xs italic">
                    … et {preview.totalAffected - 5} autre
                    {preview.totalAffected - 5 > 1 ? "s" : ""}.
                  </li>
                )}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Les abonnements existants restent sur leur version actuelle (droits préservés). Seules
              les nouvelles souscriptions utiliseront la nouvelle version.
            </p>
          </div>
        </div>
      )}
      {/* Identity */}
      <Card>
        <CardHeader>
          <CardTitle>Identité du plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            label="Clé (identifiant stable)"
            hint="Minuscules, chiffres, tirets ou underscores. Non modifiable après création."
            error={errors.key?.message}
            required
            htmlFor="key"
          >
            <div className="flex items-center gap-2">
              <Input
                id="key"
                {...register("key")}
                disabled={mode === "edit"}
                placeholder="ex. custom_acme_2026"
                className="font-mono"
              />
              {mode === "edit" && (
                <Lock
                  className="h-4 w-4 text-muted-foreground"
                  aria-label="Clé verrouillée après création"
                />
              )}
            </div>
          </FormField>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              label="Nom (Français)"
              error={errors.name?.fr?.message}
              required
              htmlFor="name-fr"
            >
              <Input id="name-fr" {...register("name.fr")} placeholder="Teranga Pro" />
            </FormField>
            <FormField
              label="Nom (English)"
              error={errors.name?.en?.message}
              required
              htmlFor="name-en"
            >
              <Input id="name-en" {...register("name.en")} placeholder="Teranga Pro" />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Description (Français)" htmlFor="description-fr">
              <Textarea
                id="description-fr"
                {...register("description.fr")}
                rows={2}
                placeholder="La suite complète pour les agences…"
              />
            </FormField>
            <FormField label="Description (English)" htmlFor="description-en">
              <Textarea
                id="description-en"
                {...register("description.en")}
                rows={2}
                placeholder="The full suite for agencies…"
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      {/* Pricing + visibility */}
      <Card>
        <CardHeader>
          <CardTitle>Tarification &amp; visibilité</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Controller
            control={control}
            name="pricingModel"
            render={({ field }) => {
              const model = field.value as PricingModel;
              const hints: Record<PricingModel, string> = {
                free: "Plan gratuit. Le prix n'est pas affiché.",
                fixed:
                  "Tarif fixe récurrent. Le montant saisi ci-dessous est facturé chaque cycle.",
                custom:
                  "Sur devis. Le prix n'est pas affiché publiquement — contact commercial requis.",
                metered: "Forfait de base + facturation à l'usage (au-delà des quotas inclus).",
              };
              return (
                <FormField
                  label="Modèle de tarification"
                  hint={hints[model]}
                  error={errors.pricingModel?.message}
                  required
                  htmlFor="pricingModel"
                >
                  <Select
                    id="pricingModel"
                    value={field.value}
                    onChange={(e) => field.onChange(e.target.value as PricingModel)}
                  >
                    <option value="free">Gratuit (free)</option>
                    <option value="fixed">Tarif fixe (fixed)</option>
                    <option value="custom">Sur devis (custom)</option>
                    <option value="metered">À l'usage (metered)</option>
                  </Select>
                </FormField>
              );
            }}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              label="Prix mensuel (XOF)"
              hint={
                watch("pricingModel") === "free"
                  ? "Verrouillé à 0 pour un plan gratuit."
                  : watch("pricingModel") === "custom"
                    ? "Ignoré pour un plan sur devis."
                    : undefined
              }
              error={errors.priceXof?.message}
              required={watch("pricingModel") === "fixed" || watch("pricingModel") === "metered"}
              htmlFor="priceXof"
            >
              <Input
                id="priceXof"
                type="number"
                min={0}
                step={100}
                disabled={watch("pricingModel") === "free" || watch("pricingModel") === "custom"}
                {...register("priceXof", { setValueAs: numberOrZero })}
              />
            </FormField>
            <FormField
              label="Prix annuel (XOF)"
              hint="0 = pas de facturation annuelle. Sinon, prix total pour 12 mois (l'économie vs. mensuel est calculée automatiquement)."
              error={errors.annualPriceXof?.message}
              htmlFor="annualPriceXof"
            >
              <Input
                id="annualPriceXof"
                type="number"
                min={0}
                step={100}
                disabled={watch("pricingModel") !== "fixed"}
                {...register("annualPriceXof", { setValueAs: numberOrNull })}
              />
            </FormField>
            <FormField
              label="Ordre d'affichage"
              hint="Les plans sont triés par ordre croissant sur la page de facturation."
              error={errors.sortOrder?.message}
              htmlFor="sortOrder"
            >
              <Input
                id="sortOrder"
                type="number"
                {...register("sortOrder", { setValueAs: numberOrZero })}
              />
            </FormField>
            <FormField
              label="Durée d'essai (jours)"
              hint="0 = pas d'essai. Un premier passage du plan Gratuit ouvre automatiquement un essai de cette durée."
              error={errors.trialDays?.message}
              htmlFor="trialDays"
            >
              <Input
                id="trialDays"
                type="number"
                min={0}
                max={365}
                step={1}
                {...register("trialDays", { setValueAs: numberOrNull })}
              />
            </FormField>
          </div>

          <Controller
            control={control}
            name="isPublic"
            render={({ field }) => (
              <div className="flex items-center gap-3">
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  label="Plan public"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">Plan public</p>
                  <p className="text-xs text-muted-foreground">
                    Les plans publics apparaissent sur la page de facturation des organisations.
                  </p>
                </div>
              </div>
            )}
          />
        </CardContent>
      </Card>

      {/* Limits */}
      <Card>
        <CardHeader>
          <CardTitle>Limites</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LimitField
            name="maxEvents"
            label="Événements actifs (max)"
            hint="Nombre maximum d'événements publiés simultanément."
            watch={watch}
            setValue={setValue}
            register={register}
            error={errors.limits?.maxEvents?.message}
          />
          <LimitField
            name="maxParticipantsPerEvent"
            label="Participants par événement (max)"
            watch={watch}
            setValue={setValue}
            register={register}
            error={errors.limits?.maxParticipantsPerEvent?.message}
          />
          <LimitField
            name="maxMembers"
            label="Membres de l'organisation (max)"
            watch={watch}
            setValue={setValue}
            register={register}
            error={errors.limits?.maxMembers?.message}
          />
        </CardContent>
      </Card>

      {/* Features */}
      <Card>
        <CardHeader>
          <CardTitle>Fonctionnalités</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(Object.keys(FEATURE_LABELS) as (keyof PlanFeatures)[]).map((key) => (
              <li key={key}>
                <Controller
                  control={control}
                  name={`features.${key}` as const}
                  render={({ field }) => (
                    <label className="flex items-start gap-3 p-3 rounded-lg border bg-background hover:bg-muted/30 transition-colors cursor-pointer">
                      <Switch
                        checked={!!field.value}
                        onCheckedChange={field.onChange}
                        label={FEATURE_LABELS[key].fr}
                      />
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {FEATURE_LABELS[key].fr}
                        </p>
                        {FEATURE_LABELS[key].hint && (
                          <p className="text-xs text-muted-foreground">
                            {FEATURE_LABELS[key].hint}
                          </p>
                        )}
                      </div>
                    </label>
                  )}
                />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Entitlements (Phase 7+ item #2) — MVP JSON editor.
          Proper per-kind UI is a follow-up; for now super-admins can
          express any entitlement shape (boolean / quota / tiered) via
          raw JSON. The Features + Limits cards above stay authoritative
          for plans that don't use entitlements; when this field IS set,
          the resolver projects these cards' values from the entitlement
          map on the server, making the cards a read-only preview for
          unified plans. */}
      <Card>
        <CardHeader>
          <CardTitle>Entitlements (avancé)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Modèle unifié qui remplace les cartes «&nbsp;Fonctionnalités&nbsp;» et
            «&nbsp;Limites&nbsp;» ci-dessus. Les clés suivent la convention{" "}
            <code className="font-mono">feature.*</code>,{" "}
            <code className="font-mono">quota.*</code> ou{" "}
            <code className="font-mono">tiered.*</code>. Laisser vide pour rester sur le
            modèle classique.
          </p>

          {entitlementsOverrideActive && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                Ce plan utilise le modèle entitlements. Pour chaque clé présente
                ci-dessous, la valeur appliquée est celle du JSON&nbsp;; les cartes
                «&nbsp;Fonctionnalités&nbsp;» et «&nbsp;Limites&nbsp;» restent utilisées
                comme valeurs par défaut pour les clés non couvertes.
              </div>
            </div>
          )}

          <FormField label="Map JSON" htmlFor="entitlements-json">
            <Textarea
              id="entitlements-json"
              value={entitlementsJson}
              onChange={(e) => {
                setEntitlementsJson(e.target.value);
                setEntitlementsDirty(true);
              }}
              rows={12}
              placeholder={`{\n  "feature.qrScanning": { "kind": "boolean", "value": true },\n  "quota.events": { "kind": "quota", "limit": 10, "period": "cycle" }\n}`}
              className="font-mono text-xs"
              aria-invalid={entitlementsError != null}
              aria-describedby={entitlementsError ? "entitlements-json-error" : undefined}
            />
          </FormField>

          {entitlementsError && (
            <p
              id="entitlements-json-error"
              className="flex items-start gap-2 text-xs text-destructive"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{entitlementsError}</span>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        {isSystem && (
          <p className="text-xs text-muted-foreground mr-auto">
            <Lock className="inline h-3.5 w-3.5 mr-1" />
            Plan système — protégé contre l'archivage et le changement de clé.
          </p>
        )}
        <Button type="button" variant="outline" onClick={() => router.push("/admin/plans")}>
          Annuler
        </Button>
        <Button type="submit" disabled={isBusy || isSubmitting || (mode === "edit" && !isDirty)}>
          {mode === "create" ? "Créer le plan" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}

// ─── Limit field with "Illimité" toggle ───────────────────────────────────

interface LimitFieldProps {
  name: keyof Plan["limits"];
  label: string;
  hint?: string;
  watch: ReturnType<typeof useForm<PlanFormValues>>["watch"];
  setValue: ReturnType<typeof useForm<PlanFormValues>>["setValue"];
  register: ReturnType<typeof useForm<PlanFormValues>>["register"];
  error?: string;
}

function LimitField({ name, label, hint, watch, setValue, register, error }: LimitFieldProps) {
  const fieldPath = `limits.${name}` as const;
  const currentValue = watch(fieldPath);
  const isUnlimited = currentValue === PLAN_LIMIT_UNLIMITED;

  const htmlId = `limit-${name}`;

  return (
    <FormField label={label} hint={hint} error={error} htmlFor={htmlId}>
      <div className="flex items-center gap-3">
        <Input
          id={htmlId}
          type="number"
          min={0}
          // `valueAsNumber: true` emits NaN when the input is cleared
          // (e.g. user hits backspace mid-edit). NaN serialises to `null`
          // in JSON and gets rejected by the server's
          // `z.number().int()` limits schema with a 400. `numberOrZero`
          // keeps the form state a finite integer at all times.
          {...register(fieldPath, { setValueAs: numberOrZero })}
          disabled={isUnlimited}
          className="max-w-xs"
        />
        <div className="flex items-center gap-2">
          <Switch
            checked={isUnlimited}
            onCheckedChange={(checked) =>
              setValue(fieldPath, checked ? PLAN_LIMIT_UNLIMITED : 0, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            label="Illimité"
          />
          <span className="text-sm text-muted-foreground">Illimité</span>
        </div>
      </div>
    </FormField>
  );
}
