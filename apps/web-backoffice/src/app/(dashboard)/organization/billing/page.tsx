"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CreditCard, Building2, Loader2, CalendarClock, Sparkles } from "lucide-react";
import {
  useOrganization,
  useSubscription,
  useUpgradePlan,
  useDowngradePlan,
  useCancelSubscription,
  useRevertScheduledChange,
} from "@/hooks/use-organization";
import { usePlanGating } from "@/hooks/use-plan-gating";
import { usePlansCatalogMap, getPlanDisplay } from "@/hooks/use-plans-catalog";
import { UsageMeter } from "@/components/plan/UsageMeter";
import { PlanComparisonTable } from "@/components/plan/PlanComparisonTable";
import { UpgradePreview } from "@/components/plan/UpgradeDialog";
import type { OrganizationPlan } from "@teranga/shared-types";
import { useTranslations } from "next-intl";

function formatPrice(priceXof: number): string {
  return new Intl.NumberFormat("fr-SN", {
    style: "currency",
    currency: "XOF",
    maximumFractionDigits: 0,
  }).format(priceXof);
}

function formatPlanCost(display: { priceXof: number; pricingModel: string }): string {
  switch (display.pricingModel) {
    case "free":
      return "Gratuit";
    case "custom":
      return "Sur devis";
    case "metered":
      return display.priceXof > 0
        ? `${formatPrice(display.priceXof)} de base + à l'usage`
        : "À l'usage";
    case "fixed":
    default:
      return `${formatPrice(display.priceXof)} / mois`;
  }
}

const PLAN_ORDER: OrganizationPlan[] = ["free", "starter", "pro", "enterprise"];

export default function BillingPage() {
  const tCommon = useTranslations("common");
  void tCommon;
  const { data: orgData, isLoading: orgLoading } = useOrganization();
  const { data: subData } = useSubscription();
  const { plan, checkLimit } = usePlanGating();

  const upgradePlan = useUpgradePlan();
  const downgradePlan = useDowngradePlan();
  const cancelSubscription = useCancelSubscription();
  const revertScheduled = useRevertScheduledChange();
  const { map: planCatalog } = usePlansCatalogMap();

  const [selectedPlan, setSelectedPlan] = useState<OrganizationPlan | null>(null);

  const org = orgData?.data;
  const subscription = subData?.data;
  const currentPlanKey = org?.effectivePlanKey ?? plan;
  const display = getPlanDisplay(currentPlanKey, planCatalog);
  const events = checkLimit("events");
  const members = checkLimit("members");
  const scheduledChange = subscription?.scheduledChange;
  const overrides = subscription?.overrides;
  const overridesActive =
    overrides && (!overrides.validUntil || new Date(overrides.validUntil).getTime() > Date.now());

  const handleSelectPlan = (target: OrganizationPlan) => {
    if (target === plan) {
      setSelectedPlan(null);
      return;
    }
    setSelectedPlan(target);
  };

  const handleConfirmChange = async () => {
    if (!selectedPlan) return;
    const isUpgrade = PLAN_ORDER.indexOf(selectedPlan) > PLAN_ORDER.indexOf(plan);
    try {
      if (isUpgrade) {
        await upgradePlan.mutateAsync(selectedPlan);
        toast.success(
          `Plan mis à niveau vers ${getPlanDisplay(selectedPlan, planCatalog).name.fr}`,
        );
      } else {
        // Default: schedule at currentPeriodEnd (prepaid rights honored).
        const result = await downgradePlan.mutateAsync({ plan: selectedPlan });
        if (result?.data?.scheduled && result.data.effectiveAt) {
          const date = new Date(result.data.effectiveAt).toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
            year: "numeric",
          });
          toast.success(
            `Rétrogradation programmée pour le ${date}. Vous conservez votre plan actuel jusqu'à cette date.`,
          );
        } else {
          toast.success(
            `Plan rétrogradé vers ${getPlanDisplay(selectedPlan, planCatalog).name.fr}`,
          );
        }
      }
      setSelectedPlan(null);
    } catch (err) {
      toast.error((err as Error).message || "Erreur lors du changement de plan");
    }
  };

  const handleCancel = async () => {
    try {
      const result = await cancelSubscription.mutateAsync({});
      if (result?.data?.scheduled && result.data.effectiveAt) {
        const date = new Date(result.data.effectiveAt).toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });
        toast.success(
          `Annulation programmée pour le ${date}. Vous conservez votre abonnement jusqu'à cette date.`,
        );
      } else {
        toast.success("Abonnement annulé. Vous êtes maintenant sur le plan gratuit.");
      }
    } catch (err) {
      toast.error((err as Error).message || "Erreur lors de l'annulation");
    }
  };

  const handleRevertScheduled = async () => {
    try {
      await revertScheduled.mutateAsync();
      toast.success("Changement de plan annulé. Votre abonnement reste actif.");
    } catch (err) {
      toast.error((err as Error).message || "Erreur lors de l'annulation du changement");
    }
  };

  if (orgLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <Building2 className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
        <p>Aucune organisation trouvée.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-8">
      {/* Header */}
      <div>
        <nav className="text-sm text-muted-foreground mb-4">
          <Link href="/organization" className="hover:text-foreground transition-colors">
            Organisation
          </Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Facturation</span>
        </nav>
        <h1 className="text-2xl font-bold text-foreground">Facturation & Plan</h1>
        <p className="text-muted-foreground mt-1">
          Gérez votre abonnement et consultez votre utilisation.
        </p>
      </div>

      {/* Custom-plan override banner (Phase 5: admin per-org assign) */}
      {overridesActive && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 shrink-0 text-primary mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-medium text-foreground">Plan personnalisé actif</p>
              <p className="text-sm text-muted-foreground">
                Un administrateur a appliqué des règles personnalisées à votre abonnement.
                {overrides?.validUntil ? (
                  <>
                    {" "}
                    Valide jusqu'au{" "}
                    <strong>
                      {new Date(overrides.validUntil).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </strong>
                    .
                  </>
                ) : null}
              </p>
              {overrides?.notes && (
                <p className="mt-1 text-xs text-muted-foreground italic">
                  Note : {overrides.notes}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Scheduled change banner (Phase 4c: prepaid period honoring) */}
      {scheduledChange && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-xl border border-teranga-gold/40 bg-teranga-gold/10 p-4 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <CalendarClock
              className="h-5 w-5 shrink-0 text-teranga-gold mt-0.5"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium text-foreground">
                {scheduledChange.reason === "cancel"
                  ? "Annulation programmée"
                  : scheduledChange.reason === "trial_ended"
                    ? "Fin de votre essai gratuit"
                    : "Changement de plan programmé"}
              </p>
              <p className="text-sm text-muted-foreground">
                {scheduledChange.reason === "trial_ended" ? (
                  <>
                    Votre essai gratuit se termine le{" "}
                    <strong>
                      {new Date(scheduledChange.effectiveAt).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </strong>
                    . La facturation de votre plan <strong>{display.name.fr}</strong> démarrera
                    automatiquement à cette date.
                  </>
                ) : (
                  <>
                    Vous conservez votre plan <strong>{display.name.fr}</strong> jusqu&apos;au{" "}
                    <strong>
                      {new Date(scheduledChange.effectiveAt).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </strong>
                    , puis basculement vers{" "}
                    <strong>{getPlanDisplay(scheduledChange.toPlan, planCatalog).name.fr}</strong>.
                  </>
                )}
              </p>
            </div>
          </div>
          {/* Reverting a "trial_ended" schedule would mean "cancel the trial
              and activate now" — not a user-facing action yet. Only offer the
              revert button on cancel / downgrade scheduledChanges. */}
          {scheduledChange.reason !== "trial_ended" && (
            <button
              type="button"
              onClick={handleRevertScheduled}
              disabled={revertScheduled.isPending}
              className="self-start rounded-lg border border-teranga-gold/60 bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-teranga-gold/10 transition-colors disabled:opacity-60"
            >
              {revertScheduled.isPending ? "Annulation…" : "Annuler le changement"}
            </button>
          )}
        </div>
      )}

      {/* Current plan card */}
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">Plan actuel</h2>
              {subscription?.status === "trialing" && (
                <span className="inline-flex items-center rounded-full bg-teranga-gold/15 px-2 py-0.5 text-[11px] font-medium text-teranga-gold">
                  Essai en cours
                </span>
              )}
            </div>
            <p className="text-2xl font-bold text-primary mt-2">{display.name.fr}</p>
            <p className="text-muted-foreground text-sm mt-0.5">{formatPlanCost(display)}</p>
          </div>
          {subscription?.currentPeriodEnd && plan !== "free" && (
            <div className="text-right text-sm text-muted-foreground">
              <p>Prochain renouvellement</p>
              <p className="font-medium text-foreground">
                {new Date(subscription.currentPeriodEnd).toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            </div>
          )}
        </div>

        {/* Usage summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <UsageMeter label="Événements actifs" current={events.current} limit={events.limit} />
          <UsageMeter label="Membres" current={members.current} limit={members.limit} />
        </div>

        {/* Cancel subscription */}
        {plan !== "free" && (
          <div className="pt-4 border-t border-border">
            <button
              onClick={handleCancel}
              disabled={cancelSubscription.isPending}
              className="text-sm text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors"
            >
              {cancelSubscription.isPending ? "Annulation..." : "Annuler l'abonnement"}
            </button>
          </div>
        )}
      </div>

      {/* Upgrade preview (shown when a plan is selected) */}
      {selectedPlan && (
        <UpgradePreview
          currentPlan={plan}
          targetPlan={selectedPlan}
          onConfirm={handleConfirmChange}
          onCancel={() => setSelectedPlan(null)}
          isPending={upgradePlan.isPending || downgradePlan.isPending}
        />
      )}

      {/* Plan comparison */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-4">Comparer les plans</h2>
        <PlanComparisonTable currentPlan={plan} onSelectPlan={handleSelectPlan} />
      </div>
    </div>
  );
}
