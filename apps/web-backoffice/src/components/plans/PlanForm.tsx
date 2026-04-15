"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import {
  CreatePlanSchema,
  PLAN_LIMIT_UNLIMITED,
  type CreatePlanDto,
  type Plan,
  type PlanFeatures,
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
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { useCreatePlan, useUpdatePlan } from "@/hooks/use-admin";

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

  const onSubmit = async (data: PlanFormValues) => {
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
        });
        toast.success("Plan créé");
        router.push("/admin/plans");
      } else if (plan) {
        // UpdatePlanSchema is partial — still send the full shape, the server
        // accepts any subset.
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
                {...register("priceXof", { valueAsNumber: true })}
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
                {...register("annualPriceXof", { valueAsNumber: true })}
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
                {...register("sortOrder", { valueAsNumber: true })}
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
                {...register("trialDays", { valueAsNumber: true })}
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
          {...register(fieldPath, { valueAsNumber: true })}
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
