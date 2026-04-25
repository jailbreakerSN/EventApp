"use client";

import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import {
  CreatePlanCouponSchema,
  UpdatePlanCouponSchema,
  type CreatePlanCouponDto,
  type PlanCoupon,
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
import { toast } from "sonner";
import {
  useCreateCoupon,
  useUpdateCoupon,
} from "@/hooks/use-admin";
import { useAdminPlans } from "@/hooks/use-admin";

// ─── Form shape ──────────────────────────────────────────────────────────
// Closer to what the inputs yield than the DTO (comma-separated plan ids as
// text, dates as "YYYY-MM-DD"). We map to the DTO shape in onSubmit.
interface FormValues {
  code: string;
  label: string;
  discountType: "percentage" | "fixed";
  discountValue: string;
  appliedPlanIds: string[];
  cycleMonthly: boolean;
  cycleAnnual: boolean;
  maxUses: string;
  maxUsesPerOrg: string;
  startsAt: string;
  expiresAt: string;
  isActive: boolean;
}

interface CouponFormProps {
  mode: "create" | "edit";
  coupon?: PlanCoupon;
}

function toIsoOrNull(d: string): string | null {
  if (!d) return null;
  // `YYYY-MM-DD` → UTC midnight (matches the admin's Dakar expectations —
  // the backend only cares about the ordering, not the hour).
  return new Date(`${d}T00:00:00.000Z`).toISOString();
}

function fromIso(d: string | null): string {
  if (!d) return "";
  return d.slice(0, 10);
}

export function CouponForm({ mode, coupon }: CouponFormProps) {
  const router = useRouter();
  const createMut = useCreateCoupon();
  const updateMut = useUpdateCoupon();
  const { data: plansData } = useAdminPlans();
  const plans = plansData?.data ?? [];

  const defaults: FormValues = {
    code: coupon?.code ?? "",
    label: coupon?.label ?? "",
    discountType: coupon?.discountType ?? "percentage",
    discountValue: coupon?.discountValue?.toString() ?? "",
    appliedPlanIds: coupon?.appliedPlanIds ?? [],
    cycleMonthly: coupon?.appliedCycles?.includes("monthly") ?? true,
    cycleAnnual: coupon?.appliedCycles?.includes("annual") ?? true,
    maxUses: coupon?.maxUses?.toString() ?? "",
    maxUsesPerOrg: coupon?.maxUsesPerOrg?.toString() ?? "",
    startsAt: fromIso(coupon?.startsAt ?? null),
    expiresAt: fromIso(coupon?.expiresAt ?? null),
    isActive: coupon?.isActive ?? true,
  };

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: defaults,
  });

  const discountType = watch("discountType");
  const cycleMonthly = watch("cycleMonthly");
  const cycleAnnual = watch("cycleAnnual");
  const appliedPlanIds = watch("appliedPlanIds");

  const onSubmit = handleSubmit(async (values) => {
    const cycles: ("monthly" | "annual")[] = [];
    if (values.cycleMonthly) cycles.push("monthly");
    if (values.cycleAnnual) cycles.push("annual");

    const dto: CreatePlanCouponDto = {
      code: values.code.toUpperCase(),
      label: values.label || null,
      discountType: values.discountType,
      discountValue: Number(values.discountValue),
      appliedPlanIds: values.appliedPlanIds.length > 0 ? values.appliedPlanIds : null,
      // Empty array means "all cycles" — map to null. Array of 2 == [monthly, annual]
      // is the same as null; collapse to keep Firestore rows uniform.
      appliedCycles: cycles.length === 0 || cycles.length === 2 ? null : cycles,
      maxUses: values.maxUses ? Number(values.maxUses) : null,
      maxUsesPerOrg: values.maxUsesPerOrg ? Number(values.maxUsesPerOrg) : null,
      startsAt: toIsoOrNull(values.startsAt),
      expiresAt: toIsoOrNull(values.expiresAt),
    };

    if (mode === "create") {
      const parsed = CreatePlanCouponSchema.safeParse(dto);
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? "Champs invalides");
        return;
      }
      try {
        await createMut.mutateAsync(parsed.data);
        toast.success(`Coupon « ${dto.code} » créé`);
        router.push("/admin/coupons");
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Échec de la création");
      }
    } else if (coupon) {
      // On edit we treat the whole payload as a partial update; most fields
      // are overwritten wholesale but `code` + `discountType` + `discountValue`
      // are structurally immutable (they'd invalidate past redemptions' snapshot).
      const updateDto = {
        label: dto.label,
        appliedPlanIds: dto.appliedPlanIds,
        appliedCycles: dto.appliedCycles,
        maxUses: dto.maxUses,
        maxUsesPerOrg: dto.maxUsesPerOrg,
        startsAt: dto.startsAt,
        expiresAt: dto.expiresAt,
        isActive: values.isActive,
      };
      const parsed = UpdatePlanCouponSchema.safeParse(updateDto);
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? "Champs invalides");
        return;
      }
      try {
        await updateMut.mutateAsync({ couponId: coupon.id, dto: parsed.data });
        toast.success(`Coupon « ${coupon.code} » mis à jour`);
        router.push("/admin/coupons");
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Échec de la mise à jour");
      }
    }
  });

  const togglePlanId = (planId: string) => {
    const next = appliedPlanIds.includes(planId)
      ? appliedPlanIds.filter((id) => id !== planId)
      : [...appliedPlanIds, planId];
    setValue("appliedPlanIds", next, { shouldDirty: true });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Identité du coupon</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            label="Code"
            required
            error={errors.code?.message}
            hint="Majuscules + chiffres + - _. Par convention : LAUNCH2026, PARTNER_SONATEL, etc."
          >
            <Input
              {...register("code", {
                required: "Le code est requis",
                pattern: {
                  value: /^[A-Z0-9_-]{3,50}$/,
                  message: "Format : 3 à 50 caractères, majuscules / chiffres / _ / -",
                },
                setValueAs: (v: string) => v.toUpperCase(),
              })}
              placeholder="LAUNCH2026"
              disabled={mode === "edit"}
              aria-readonly={mode === "edit"}
            />
          </FormField>

          <FormField label="Libellé interne" error={errors.label?.message}>
            <Textarea
              {...register("label", { maxLength: 200 })}
              rows={2}
              placeholder="Ex : Campagne de lancement Q2 — partenariat Sonatel"
            />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Remise</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label="Type de remise" required>
            <Select
              {...register("discountType", { required: true })}
              disabled={mode === "edit"}
              aria-readonly={mode === "edit"}
            >
              <option value="percentage">Pourcentage</option>
              <option value="fixed">Montant fixe (XOF)</option>
            </Select>
          </FormField>

          <FormField
            label={discountType === "percentage" ? "Pourcentage (1-100)" : "Montant XOF"}
            required
            error={errors.discountValue?.message}
          >
            <Input
              {...register("discountValue", {
                required: "Ce champ est requis",
                validate: (v: string) => {
                  const n = Number(v);
                  if (Number.isNaN(n) || n <= 0) return "Doit être un nombre positif";
                  if (discountType === "percentage" && n > 100) return "Maximum 100 %";
                  return true;
                },
              })}
              type="number"
              inputMode="numeric"
              disabled={mode === "edit"}
              aria-readonly={mode === "edit"}
            />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Portée</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            label="Plans ciblés"
            hint="Laisser vide pour s'appliquer à tous les plans du catalogue."
          >
            <div className="space-y-2">
              {plans.length === 0 && (
                <p className="text-xs text-muted-foreground">Chargement du catalogue…</p>
              )}
              {plans.map((plan) => {
                const checked = appliedPlanIds.includes(plan.id);
                return (
                  <label key={plan.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePlanId(plan.id)}
                      className="h-4 w-4"
                    />
                    <span className="font-medium text-foreground">{plan.name.fr}</span>
                    <span className="text-xs text-muted-foreground font-mono">{plan.key}</span>
                  </label>
                );
              })}
            </div>
          </FormField>

          <FormField
            label="Cycles facturation"
            hint="Décocher un cycle pour exclure — cocher les deux = s'applique à tous."
          >
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={cycleMonthly}
                  onChange={(e) => setValue("cycleMonthly", e.target.checked)}
                  className="h-4 w-4"
                />
                <span>Mensuel</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={cycleAnnual}
                  onChange={(e) => setValue("cycleAnnual", e.target.checked)}
                  className="h-4 w-4"
                />
                <span>Annuel</span>
              </label>
            </div>
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plafonds d&apos;utilisation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            label="Utilisations maximum (global)"
            hint="Vide = illimité."
            error={errors.maxUses?.message}
          >
            <Input
              {...register("maxUses", {
                validate: (v: string) =>
                  !v || Number(v) > 0 || "Doit être un entier positif ou vide",
              })}
              type="number"
              inputMode="numeric"
              placeholder="100"
            />
          </FormField>

          <FormField
            label="Utilisations max par organisation"
            hint="Vide = pas de limite par org."
            error={errors.maxUsesPerOrg?.message}
          >
            <Input
              {...register("maxUsesPerOrg", {
                validate: (v: string) =>
                  !v || Number(v) > 0 || "Doit être un entier positif ou vide",
              })}
              type="number"
              inputMode="numeric"
              placeholder="1"
            />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fenêtre de validité</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            label="Date de début (optionnel)"
            hint="Vide = actif dès sa création."
            error={errors.startsAt?.message}
          >
            <Input {...register("startsAt")} type="date" />
          </FormField>

          <FormField
            label="Date d'expiration (optionnel)"
            hint="Vide = pas de date d'expiration."
            error={errors.expiresAt?.message}
          >
            <Input {...register("expiresAt")} type="date" />
          </FormField>
        </CardContent>
      </Card>

      {mode === "edit" && (
        <Card>
          <CardHeader>
            <CardTitle>Statut</CardTitle>
          </CardHeader>
          <CardContent>
            <Switch
              checked={watch("isActive")}
              onCheckedChange={(v) => setValue("isActive", v)}
              label="Coupon actif"
            />
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin/coupons")}
        >
          Annuler
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {mode === "create" ? "Créer le coupon" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
