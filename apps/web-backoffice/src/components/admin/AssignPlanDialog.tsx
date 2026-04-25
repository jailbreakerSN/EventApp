"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  FormField,
  InlineErrorBanner,
  Input,
  Select,
  Switch,
  Textarea,
} from "@teranga/shared-ui";
import { Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useErrorHandler, type ResolvedError } from "@/hooks/use-error-handler";
import {
  AssignPlanSchema,
  EntitlementMapSchema,
  PLAN_LIMIT_UNLIMITED,
  type AssignPlanDto,
  type EntitlementMap,
  type Organization,
  type Plan,
  type PlanFeatures,
} from "@teranga/shared-types";
import { useAdminPlans, useAssignPlan } from "@/hooks/use-admin";

// ─── Props ───────────────────────────────────────────────────────────────

export interface AssignPlanDialogProps {
  open: boolean;
  org: Organization;
  onClose: () => void;
}

// ─── Feature labels (mirrors the PlanForm component) ────────────────────

const FEATURE_LABELS: Record<keyof PlanFeatures, string> = {
  qrScanning: "Scan QR",
  paidTickets: "Billets payants",
  customBadges: "Badges personnalisés",
  csvExport: "Export CSV",
  smsNotifications: "Notifications SMS",
  advancedAnalytics: "Analytics avancées",
  speakerPortal: "Portail intervenants",
  sponsorPortal: "Portail sponsors",
  apiAccess: "Accès API",
  whiteLabel: "Marque blanche",
  promoCodes: "Codes promo",
  waitlist: "Liste d'attente",
};

type LimitKey = "maxEvents" | "maxParticipantsPerEvent" | "maxMembers";
type FeatureKey = keyof PlanFeatures;

// ─── Form shape ──────────────────────────────────────────────────────────
//
// UI model carries the individual override toggles so users can opt into
// each override independently. On submit we convert to the API DTO shape
// (only include overrides the admin explicitly enabled).

interface FormValues {
  planId: string;
  // Limit overrides
  overrideMaxEvents: boolean;
  maxEvents: number;
  maxEventsUnlimited: boolean;
  overrideMaxParticipants: boolean;
  maxParticipants: number;
  maxParticipantsUnlimited: boolean;
  overrideMaxMembers: boolean;
  maxMembers: number;
  maxMembersUnlimited: boolean;
  // Feature overrides (explicit opt-in per feature)
  overriddenFeatures: Record<FeatureKey, { enabled: boolean; value: boolean }>;
  // Misc overrides
  overridePrice: boolean;
  priceXof: number;
  validUntil: string; // empty → no validUntil
  notes: string;
  // A1 — explicit per-key entitlement overrides (JSON MVP).
  // Empty string → no entitlement override (legacy path).
  entitlementsJson: string;
}

// ─── Dialog ─────────────────────────────────────────────────────────────

export function AssignPlanDialog({ open, org, onClose }: AssignPlanDialogProps) {
  const plansQuery = useAdminPlans({ includeArchived: false });
  const assignPlan = useAssignPlan();
  const [submitError, setSubmitError] = useState<ResolvedError | null>(null);
  // A1 — inline error for the entitlement override JSON textarea.
  // Null = no error; string = current validation error to render under
  // the field. Cleared on successful parse inside onSubmit.
  const [entitlementsJsonError, setEntitlementsJsonError] = useState<string | null>(null);
  const { resolve: resolveError } = useErrorHandler();
  const tErrors = useTranslations("errors");
  const tErrorActions = useTranslations("errors.actions");
  const tErrorValidation = useTranslations("errors.validation");

  const plans = useMemo<Plan[]>(() => plansQuery.data?.data ?? [], [plansQuery.data]);

  const defaults: FormValues = useMemo(() => {
    const emptyFeatures = Object.keys(FEATURE_LABELS).reduce(
      (acc, key) => {
        acc[key as FeatureKey] = { enabled: false, value: false };
        return acc;
      },
      {} as FormValues["overriddenFeatures"],
    );
    return {
      planId: plans[0]?.id ?? "",
      overrideMaxEvents: false,
      maxEvents: 10,
      maxEventsUnlimited: false,
      overrideMaxParticipants: false,
      maxParticipants: 200,
      maxParticipantsUnlimited: false,
      overrideMaxMembers: false,
      maxMembers: 3,
      maxMembersUnlimited: false,
      overriddenFeatures: emptyFeatures,
      overridePrice: false,
      priceXof: 0,
      validUntil: "",
      notes: "",
      entitlementsJson: "",
    };
  }, [plans]);

  const {
    register,
    control,
    watch,
    setValue,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: defaults, mode: "onBlur" });

  // Reset when the dialog opens or the plans list first loads.
  useEffect(() => {
    if (open) reset(defaults);
  }, [open, defaults, reset]);

  const selectedPlanId = watch("planId");
  const selectedPlan = plans.find((p) => p.id === selectedPlanId);

  const onSubmit = async (values: FormValues) => {
    // Build the overrides object — only include keys the admin explicitly toggled.
    const limits: Partial<Record<LimitKey, number>> = {};
    if (values.overrideMaxEvents) {
      limits.maxEvents = values.maxEventsUnlimited ? PLAN_LIMIT_UNLIMITED : values.maxEvents;
    }
    if (values.overrideMaxParticipants) {
      limits.maxParticipantsPerEvent = values.maxParticipantsUnlimited
        ? PLAN_LIMIT_UNLIMITED
        : values.maxParticipants;
    }
    if (values.overrideMaxMembers) {
      limits.maxMembers = values.maxMembersUnlimited ? PLAN_LIMIT_UNLIMITED : values.maxMembers;
    }

    const features: Partial<PlanFeatures> = {};
    for (const [k, v] of Object.entries(values.overriddenFeatures)) {
      if (v.enabled) features[k as FeatureKey] = v.value;
    }

    // ── A1 — parse + strict-validate the entitlement override JSON.
    // Empty textarea → no override. Malformed JSON / Zod rejection
    // block submit with an inline error (admin never submits garbage).
    let entitlementsOverride: EntitlementMap | undefined;
    const rawEntitlementsJson = values.entitlementsJson.trim();
    if (rawEntitlementsJson) {
      try {
        const parsed = JSON.parse(rawEntitlementsJson);
        const zodResult = EntitlementMapSchema.safeParse(parsed);
        if (!zodResult.success) {
          const first = zodResult.error.issues[0];
          setEntitlementsJsonError(
            first
              ? `${first.path.join(".") || "(root)"}: ${first.message}`
              : "JSON invalide",
          );
          return;
        }
        setEntitlementsJsonError(null);
        if (Object.keys(zodResult.data).length > 0) {
          entitlementsOverride = zodResult.data;
        }
      } catch (err) {
        setEntitlementsJsonError(
          `JSON malformé : ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
    } else {
      setEntitlementsJsonError(null);
    }

    const hasLimitOverride = Object.keys(limits).length > 0;
    const hasFeatureOverride = Object.keys(features).length > 0;
    const hasPriceOverride = values.overridePrice;
    const hasValidUntil = !!values.validUntil;
    const hasNotes = !!values.notes.trim();
    const hasEntitlementOverride = !!entitlementsOverride;
    const hasAnyOverride =
      hasLimitOverride ||
      hasFeatureOverride ||
      hasPriceOverride ||
      hasValidUntil ||
      hasNotes ||
      hasEntitlementOverride;

    const dto: AssignPlanDto = hasAnyOverride
      ? {
          planId: values.planId,
          overrides: {
            ...(hasLimitOverride ? { limits } : {}),
            ...(hasFeatureOverride ? { features } : {}),
            ...(hasEntitlementOverride ? { entitlements: entitlementsOverride } : {}),
            ...(hasPriceOverride ? { priceXof: values.priceXof } : {}),
            ...(hasNotes ? { notes: values.notes.trim() } : {}),
            ...(hasValidUntil ? { validUntil: new Date(values.validUntil).toISOString() } : {}),
          },
        }
      : { planId: values.planId };

    // Shape-validate locally before sending — the server refines too but the
    // UI catches schema errors earlier. Zod issues land as a banner so the
    // admin sees the exact field even after scrolling the long form.
    const parsed = AssignPlanSchema.safeParse(dto);
    if (!parsed.success) {
      setSubmitError(
        resolveError({
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? tErrorValidation("invalidForm"),
        }),
      );
      return;
    }

    setSubmitError(null);
    try {
      await assignPlan.mutateAsync({ orgId: org.id, dto: parsed.data });
      toast.success(
        hasAnyOverride
          ? `Plan personnalisé assigné à ${org.name}`
          : `${selectedPlan?.name.fr ?? "Plan"} assigné à ${org.name}`,
      );
      onClose();
    } catch (err) {
      setSubmitError(resolveError(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold">Assigner un plan</h2>
              <p className="text-sm text-muted-foreground">
                Pour <strong>{org.name}</strong> — plan actuel : <em>{org.plan}</em>
              </p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {submitError && (
            <InlineErrorBanner
              severity={submitError.severity}
              kicker={tErrors("kicker")}
              title={submitError.title}
              description={submitError.description}
              onDismiss={() => setSubmitError(null)}
              dismissLabel={tErrorActions("dismiss")}
            />
          )}
          {/* Plan picker */}
          <FormField
            label="Plan du catalogue"
            hint="Les plans publics et privés non-archivés sont listés."
            error={errors.planId?.message}
            required
            htmlFor="planId"
          >
            <Select id="planId" {...register("planId")} disabled={plansQuery.isLoading}>
              {plansQuery.isLoading && <option>Chargement…</option>}
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name.fr} ({p.key}){p.isSystem ? " · système" : ""}
                  {!p.isPublic ? " · privé" : ""}
                </option>
              ))}
            </Select>
          </FormField>

          {/* Optional overrides */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">
                Overrides personnalisés (optionnels)
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Tout champ laissé décoché utilise la valeur du plan sélectionné. Activez uniquement
              les dimensions que vous voulez surcharger pour cette organisation.
            </p>

            {/* Limits */}
            <LimitRow
              register={register}
              watch={watch}
              setValue={setValue}
              field="MaxEvents"
              label="Événements actifs (max)"
              base={selectedPlan?.limits.maxEvents}
            />
            <LimitRow
              register={register}
              watch={watch}
              setValue={setValue}
              field="MaxParticipants"
              label="Participants par événement (max)"
              base={selectedPlan?.limits.maxParticipantsPerEvent}
            />
            <LimitRow
              register={register}
              watch={watch}
              setValue={setValue}
              field="MaxMembers"
              label="Membres de l'organisation (max)"
              base={selectedPlan?.limits.maxMembers}
            />

            {/* Features */}
            <div>
              <p className="text-sm font-medium text-foreground mb-2">Fonctionnalités</p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(Object.keys(FEATURE_LABELS) as FeatureKey[]).map((key) => {
                  const baseValue = selectedPlan?.features[key] ?? false;
                  return (
                    <li key={key}>
                      <Controller
                        control={control}
                        name={`overriddenFeatures.${key}.enabled` as const}
                        render={({ field: enabledField }) => (
                          <div className="flex items-center gap-3 rounded-md border border-border bg-background p-2 text-sm">
                            <Switch
                              checked={!!enabledField.value}
                              onCheckedChange={enabledField.onChange}
                              label={`Overrider ${FEATURE_LABELS[key]}`}
                            />
                            <div className="flex-1">
                              <p className="text-foreground">{FEATURE_LABELS[key]}</p>
                              <p className="text-xs text-muted-foreground">
                                Base : {baseValue ? "activé" : "désactivé"}
                              </p>
                            </div>
                            {enabledField.value && (
                              <Controller
                                control={control}
                                name={`overriddenFeatures.${key}.value` as const}
                                render={({ field: valueField }) => (
                                  <Switch
                                    checked={!!valueField.value}
                                    onCheckedChange={valueField.onChange}
                                    label={`Valeur pour ${FEATURE_LABELS[key]}`}
                                  />
                                )}
                              />
                            )}
                          </div>
                        )}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Price */}
            <div className="flex items-center gap-3">
              <Controller
                control={control}
                name="overridePrice"
                render={({ field }) => (
                  <Switch
                    checked={!!field.value}
                    onCheckedChange={field.onChange}
                    label="Overrider le prix"
                  />
                )}
              />
              <FormField
                label="Prix personnalisé (XOF)"
                htmlFor="priceXof"
                hint={
                  selectedPlan
                    ? `Base : ${selectedPlan.priceXof.toLocaleString("fr-FR")} XOF`
                    : undefined
                }
                className="flex-1"
              >
                <Input
                  id="priceXof"
                  type="number"
                  min={0}
                  step={100}
                  disabled={!watch("overridePrice")}
                  {...register("priceXof", { valueAsNumber: true })}
                />
              </FormField>
            </div>

            {/* Validity */}
            <FormField
              label="Valide jusqu'au (optionnel)"
              hint="Laisser vide pour une override permanente. Sinon, après cette date, l'organisation bascule sur les limites de base du plan."
              htmlFor="validUntil"
            >
              <Input id="validUntil" type="date" {...register("validUntil")} />
            </FormField>

            {/* Notes */}
            <FormField
              label="Note interne (optionnelle)"
              hint="Visible dans le journal d'audit et dans le détail de l'abonnement."
              htmlFor="notes"
            >
              <Textarea
                id="notes"
                rows={2}
                placeholder="ex: Deal négocié avec Sonatel pour l'édition 2026"
                {...register("notes")}
              />
            </FormField>

            {/* A1 — entitlement override (super-admin JSON editor).
                MVP surface: super-admins can override any entitlement
                key per-org, layered on top of the plan's own
                entitlements. Strict client-side Zod validation blocks
                submit; the server runs the same check. Empty = no
                override (legacy path). */}
            <FormField
              label="Entitlements personnalisés (avancé)"
              hint={
                "JSON — clés `feature.*` / `quota.*` / `tiered.*`. " +
                "Laisser vide pour conserver les entitlements du plan. " +
                "Voir le placeholder pour un exemple."
              }
              htmlFor="entitlementsJson"
              error={entitlementsJsonError ?? undefined}
            >
              <Textarea
                id="entitlementsJson"
                rows={6}
                className="font-mono text-xs"
                placeholder={`{\n  "feature.smsNotifications": { "kind": "boolean", "value": true }\n}`}
                {...register("entitlementsJson")}
                onChange={(e) => {
                  register("entitlementsJson").onChange(e);
                  // Clear the error as soon as the admin starts editing
                  // again — otherwise a stale message persists after they
                  // fix the issue.
                  if (entitlementsJsonError) setEntitlementsJsonError(null);
                }}
                aria-invalid={entitlementsJsonError != null}
                aria-describedby={entitlementsJsonError ? "entitlementsJson-error" : undefined}
              />
            </FormField>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={isSubmitting || assignPlan.isPending}>
              {isSubmitting || assignPlan.isPending ? "Assignation…" : "Assigner le plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Limit row helper ──────────────────────────────────────────────────

interface LimitRowProps {
  register: ReturnType<typeof useForm<FormValues>>["register"];
  watch: ReturnType<typeof useForm<FormValues>>["watch"];
  setValue: ReturnType<typeof useForm<FormValues>>["setValue"];
  field: "MaxEvents" | "MaxParticipants" | "MaxMembers";
  label: string;
  base: number | undefined;
}

function LimitRow({ register, watch, setValue, field, label, base }: LimitRowProps) {
  const overrideKey = `override${field}` as
    | "overrideMaxEvents"
    | "overrideMaxParticipants"
    | "overrideMaxMembers";
  const valueKey =
    field === "MaxParticipants"
      ? "maxParticipants"
      : field === "MaxEvents"
        ? "maxEvents"
        : "maxMembers";
  const unlimitedKey = `${valueKey}Unlimited` as
    | "maxEventsUnlimited"
    | "maxParticipantsUnlimited"
    | "maxMembersUnlimited";
  const overridden = watch(overrideKey);
  const unlimited = watch(unlimitedKey);

  const baseLabel =
    base === undefined
      ? "—"
      : base === PLAN_LIMIT_UNLIMITED
        ? "Illimité"
        : base.toLocaleString("fr-FR");

  return (
    <div className="flex items-center gap-3">
      <Switch
        checked={!!overridden}
        onCheckedChange={(next) =>
          setValue(overrideKey, next, { shouldDirty: true, shouldValidate: true })
        }
        label={`Overrider ${label}`}
      />
      <FormField
        label={label}
        hint={`Base du plan : ${baseLabel}`}
        htmlFor={`limit-${field}`}
        className="flex-1"
      >
        <div className="flex items-center gap-2">
          <Input
            id={`limit-${field}`}
            type="number"
            min={0}
            disabled={!overridden || unlimited}
            {...register(valueKey, { valueAsNumber: true })}
            className="max-w-xs"
          />
          <div className="flex items-center gap-2">
            <Switch
              checked={!!unlimited}
              onCheckedChange={(next) =>
                setValue(unlimitedKey, next, { shouldDirty: true, shouldValidate: true })
              }
              label={`Illimité ${label}`}
              disabled={!overridden}
            />
            <span className="text-sm text-muted-foreground">Illimité</span>
          </div>
        </div>
      </FormField>
    </div>
  );
}
