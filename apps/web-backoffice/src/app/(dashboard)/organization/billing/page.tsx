"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CreditCard, Building2, Loader2, CalendarClock } from "lucide-react";
import {
  useOrganization,
  useSubscription,
  useUpgradePlan,
  useDowngradePlan,
  useCancelSubscription,
  useRevertScheduledChange,
} from "@/hooks/use-organization";
import { usePlanGating } from "@/hooks/use-plan-gating";
import { UsageMeter } from "@/components/plan/UsageMeter";
import { PlanComparisonTable } from "@/components/plan/PlanComparisonTable";
import { UpgradePreview } from "@/components/plan/UpgradeDialog";
import type { OrganizationPlan } from "@teranga/shared-types";
import { PLAN_DISPLAY } from "@teranga/shared-types";
import { useTranslations } from "next-intl";

function formatPrice(priceXof: number): string {
  if (priceXof === 0) return "Gratuit";
  return new Intl.NumberFormat("fr-SN", {
    style: "currency",
    currency: "XOF",
    maximumFractionDigits: 0,
  }).format(priceXof);
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

  const [selectedPlan, setSelectedPlan] = useState<OrganizationPlan | null>(null);

  const org = orgData?.data;
  const subscription = subData?.data;
  const display = PLAN_DISPLAY[plan];
  const events = checkLimit("events");
  const members = checkLimit("members");
  const scheduledChange = subscription?.scheduledChange;

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
        toast.success(`Plan mis à niveau vers ${PLAN_DISPLAY[selectedPlan].name.fr}`);
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
          toast.success(`Plan rétrogradé vers ${PLAN_DISPLAY[selectedPlan].name.fr}`);
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
                  : "Changement de plan programmé"}
              </p>
              <p className="text-sm text-muted-foreground">
                Vous conservez votre plan <strong>{display.name.fr}</strong> jusqu'au{" "}
                <strong>
                  {new Date(scheduledChange.effectiveAt).toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </strong>
                , puis basculement vers{" "}
                <strong>
                  {PLAN_DISPLAY[scheduledChange.toPlan as OrganizationPlan]?.name.fr ??
                    scheduledChange.toPlan}
                </strong>
                .
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRevertScheduled}
            disabled={revertScheduled.isPending}
            className="self-start rounded-lg border border-teranga-gold/60 bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-teranga-gold/10 transition-colors disabled:opacity-60"
          >
            {revertScheduled.isPending ? "Annulation…" : "Annuler le changement"}
          </button>
        </div>
      )}

      {/* Current plan card */}
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">Plan actuel</h2>
            </div>
            <p className="text-2xl font-bold text-primary mt-2">{display.name.fr}</p>
            <p className="text-muted-foreground text-sm mt-0.5">
              {display.priceXof === 0 ? "Gratuit" : `${formatPrice(display.priceXof)} / mois`}
            </p>
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
