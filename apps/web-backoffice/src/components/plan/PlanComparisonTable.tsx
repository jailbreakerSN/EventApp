"use client";

import { useState } from "react";
import { Check, X, Minus, Loader2 } from "lucide-react";
import {
  type BillingCycle,
  type OrganizationPlan,
  type Plan,
  type PlanFeature,
  PLAN_LIMIT_UNLIMITED,
} from "@teranga/shared-types";
import { usePlansCatalog } from "@/hooks/use-plans-catalog";
import { cn } from "@/lib/utils";

// ─── Phase 6 ─────────────────────────────────────────────────────────────
// Catalog-driven plan comparison. Iterates over the live `plans` collection
// (sorted by sortOrder) instead of the hardcoded enum, so superadmin-edited
// plans and pricingModel changes (free / fixed / custom / metered) render
// correctly.

const FEATURE_LABELS: Record<PlanFeature, string> = {
  qrScanning: "Scan QR / Check-in",
  paidTickets: "Billetterie payante",
  customBadges: "Badges personnalisés",
  csvExport: "Export CSV",
  smsNotifications: "Notifications SMS",
  advancedAnalytics: "Analytiques avancées",
  speakerPortal: "Portail speakers",
  sponsorPortal: "Portail sponsors",
  apiAccess: "Accès API",
  whiteLabel: "White-label",
  promoCodes: "Codes promo",
  waitlist: "Liste d'attente",
  whatsappNotifications: "Notifications WhatsApp",
};

const LIMIT_ROWS: {
  key: string;
  label: string;
  getValue: (plan: Plan) => string;
}[] = [
  { key: "events", label: "Événements actifs", getValue: (p) => formatLimit(p.limits.maxEvents) },
  {
    key: "participants",
    label: "Participants / événement",
    getValue: (p) => formatLimit(p.limits.maxParticipantsPerEvent),
  },
  {
    key: "members",
    label: "Membres de l'équipe",
    getValue: (p) => formatLimit(p.limits.maxMembers),
  },
];

function formatLimit(stored: number): string {
  return stored === PLAN_LIMIT_UNLIMITED ? "Illimité" : stored.toLocaleString("fr-FR");
}

function formatPrice(plan: Plan, cycle: BillingCycle): string {
  const model = plan.pricingModel ?? (plan.priceXof > 0 ? "fixed" : "free");
  // Annual price is only meaningful for fixed plans. If the viewer toggled to
  // "annual" but the plan doesn't publish an annualPriceXof, fall back to the
  // monthly display — the upgrade CTA next to this price will also be disabled.
  if (cycle === "annual" && model === "fixed" && plan.annualPriceXof && plan.annualPriceXof > 0) {
    return formatXof(plan.annualPriceXof);
  }
  switch (model) {
    case "free":
      return "Gratuit";
    case "custom":
      return "Sur mesure";
    case "metered":
      return plan.priceXof > 0 ? formatXof(plan.priceXof) + " + à l'usage" : "À l'usage";
    case "fixed":
    default:
      return formatXof(plan.priceXof);
  }
}

function formatXof(priceXof: number): string {
  return new Intl.NumberFormat("fr-SN", {
    style: "currency",
    currency: "XOF",
    maximumFractionDigits: 0,
  }).format(priceXof);
}

/**
 * Compute the percent savings of the annual cadence vs. monthly × 12.
 * Returns null when annual isn't offered (UI hides the badge).
 */
function annualSavingsPct(plan: Plan): number | null {
  if (!plan.annualPriceXof || plan.annualPriceXof <= 0 || plan.priceXof <= 0) return null;
  const monthlyYearly = plan.priceXof * 12;
  if (plan.annualPriceXof >= monthlyYearly) return null;
  return Math.round(((monthlyYearly - plan.annualPriceXof) / monthlyYearly) * 100);
}

interface PlanComparisonTableProps {
  currentPlan: OrganizationPlan;
  onSelectPlan?: (plan: OrganizationPlan, cycle: BillingCycle) => void;
}

export function PlanComparisonTable({ currentPlan, onSelectPlan }: PlanComparisonTableProps) {
  const { data, isLoading, isError } = usePlansCatalog();
  const plans = (data?.data ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const currentIdx = plans.findIndex((p) => p.key === currentPlan);
  const features = Object.keys(FEATURE_LABELS) as PlanFeature[];
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const anyPlanOffersAnnual = plans.some((p) => !!p.annualPriceXof && p.annualPriceXof > 0);

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center py-16 text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Chargement du catalogue…
      </div>
    );
  }
  if (isError || plans.length === 0) {
    return (
      <p className="text-center py-12 text-muted-foreground">
        Le catalogue de plans est indisponible. Veuillez réessayer plus tard.
      </p>
    );
  }

  return (
    <>
      {/* Monthly / annual toggle (Phase 7+ item #3). Hidden when no plan in
          the catalog publishes an annualPriceXof — no point offering the
          choice if it can't actually be exercised. */}
      {anyPlanOffersAnnual && (
        <div
          role="radiogroup"
          aria-label="Fréquence de facturation"
          className="mb-4 inline-flex rounded-lg border border-border bg-muted/30 p-1 text-sm"
        >
          <button
            type="button"
            role="radio"
            aria-checked={cycle === "monthly"}
            onClick={() => setCycle("monthly")}
            className={cn(
              "rounded-md px-3 py-1 font-medium transition-colors",
              cycle === "monthly"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Mensuel
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={cycle === "annual"}
            onClick={() => setCycle("annual")}
            className={cn(
              "rounded-md px-3 py-1 font-medium transition-colors",
              cycle === "annual"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Annuel
            <span className="ml-1.5 rounded-full bg-teranga-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-teranga-gold">
              −20%
            </span>
          </button>
        </div>
      )}
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th
                className="text-left py-4 pr-4 font-medium text-muted-foreground"
                style={{ width: `${Math.round(100 / (plans.length + 1))}%` }}
              />
              {plans.map((plan, idx) => {
                const isCurrent = plan.key === currentPlan;
                const model = plan.pricingModel ?? (plan.priceXof > 0 ? "fixed" : "free");
                const isFixedOrFree = model !== "custom";
                const offersAnnual = !!plan.annualPriceXof && plan.annualPriceXof > 0;
                // If the user picked annual but this plan doesn't offer it,
                // the CTA needs to fall back to monthly (the backend will
                // otherwise throw ValidationError).
                const effectiveCycle: BillingCycle =
                  cycle === "annual" && offersAnnual ? "annual" : "monthly";
                const periodLabel = effectiveCycle === "annual" ? "/ an" : "/ mois";
                const savings = annualSavingsPct(plan);
                return (
                  <th
                    key={plan.key}
                    className="py-4 px-3 text-center"
                    style={{ width: `${Math.round(100 / (plans.length + 1))}%` }}
                  >
                    <div
                      className={cn(
                        "rounded-xl p-4",
                        isCurrent ? "bg-primary/5 ring-2 ring-primary" : "bg-muted/30",
                      )}
                    >
                      {isCurrent && (
                        <span className="text-[10px] uppercase tracking-wider text-primary font-semibold mb-1 block">
                          Plan actuel
                        </span>
                      )}
                      <p className="font-semibold text-foreground">{plan.name.fr}</p>
                      <p className="text-lg font-bold text-primary mt-1">
                        {formatPrice(plan, effectiveCycle)}
                      </p>
                      {plan.priceXof > 0 && isFixedOrFree && (
                        <p className="text-xs text-muted-foreground">{periodLabel}</p>
                      )}
                      {/* Annual savings hint — only when the viewer is on the
                          annual toggle AND the plan has an annual price. */}
                      {cycle === "annual" && offersAnnual && savings && (
                        <p className="mt-1 text-[11px] font-medium text-teranga-gold">
                          Économisez {savings}% vs. mensuel
                        </p>
                      )}
                      {/* Phase 7+ item #4: surface the trial offer. Only
                          meaningful for a user upgrading from free — a
                          second upgrade won't start a new trial server-side. */}
                      {plan.trialDays &&
                        plan.trialDays > 0 &&
                        currentPlan === "free" &&
                        !isCurrent && (
                          <p className="mt-2 inline-block rounded-full bg-teranga-gold/15 px-2 py-0.5 text-[11px] font-medium text-teranga-gold">
                            {plan.trialDays} jours d&apos;essai offerts
                          </p>
                        )}
                      {onSelectPlan && !isCurrent && isFixedOrFree && (
                        <button
                          onClick={() => onSelectPlan(plan.key as OrganizationPlan, effectiveCycle)}
                          className="mt-3 w-full px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors"
                        >
                          {plan.trialDays && plan.trialDays > 0 && currentPlan === "free"
                            ? `Commencer l'essai ${plan.trialDays} jours`
                            : idx > currentIdx
                              ? "Passer à ce plan"
                              : "Rétrograder"}
                        </button>
                      )}
                      {!isFixedOrFree && !isCurrent && (
                        <a
                          href="mailto:contact@teranga.events"
                          className="mt-3 inline-block w-full px-3 py-1.5 border border-primary text-primary text-xs font-medium rounded-lg hover:bg-primary/5 transition-colors text-center"
                        >
                          Contactez-nous
                        </a>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td
                colSpan={plans.length + 1}
                className="pt-6 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider"
              >
                Limites
              </td>
            </tr>
            {LIMIT_ROWS.map((row) => (
              <tr key={row.key} className="border-b border-border/50">
                <td className="py-3 pr-4 text-muted-foreground">{row.label}</td>
                {plans.map((plan) => (
                  <td key={plan.key} className="py-3 px-3 text-center font-medium">
                    {row.getValue(plan)}
                  </td>
                ))}
              </tr>
            ))}

            <tr>
              <td
                colSpan={plans.length + 1}
                className="pt-6 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider"
              >
                Fonctionnalités
              </td>
            </tr>
            {features.map((feature) => (
              <tr key={feature} className="border-b border-border/50">
                <td className="py-3 pr-4 text-muted-foreground">{FEATURE_LABELS[feature]}</td>
                {plans.map((plan) => (
                  <td key={plan.key} className="py-3 px-3 text-center">
                    {plan.features?.[feature] ? (
                      <Check className="h-4 w-4 text-green-600 mx-auto" />
                    ) : (
                      <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-4">
        {plans.map((plan, idx) => {
          const isCurrent = plan.key === currentPlan;
          const model = plan.pricingModel ?? (plan.priceXof > 0 ? "fixed" : "free");
          const isFixedOrFree = model !== "custom";
          const offersAnnual = !!plan.annualPriceXof && plan.annualPriceXof > 0;
          const effectiveCycle: BillingCycle =
            cycle === "annual" && offersAnnual ? "annual" : "monthly";
          const periodLabel = effectiveCycle === "annual" ? "/ an" : "/ mois";

          return (
            <div
              key={plan.key}
              className={cn(
                "rounded-xl border p-5",
                isCurrent ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-semibold text-foreground">{plan.name.fr}</p>
                  <p className="text-lg font-bold text-primary">
                    {formatPrice(plan, effectiveCycle)}
                  </p>
                  {plan.priceXof > 0 && isFixedOrFree && (
                    <p className="text-xs text-muted-foreground">{periodLabel}</p>
                  )}
                </div>
                {isCurrent && (
                  <span className="px-2 py-0.5 bg-primary text-primary-foreground text-[10px] font-semibold rounded-full uppercase">
                    Actuel
                  </span>
                )}
              </div>

              <div className="space-y-2 text-sm">
                {LIMIT_ROWS.map((row) => (
                  <div key={row.key} className="flex justify-between">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-medium">{row.getValue(plan)}</span>
                  </div>
                ))}
                <div className="border-t border-border/50 pt-2 mt-2">
                  {features.map((feature) => (
                    <div key={feature} className="flex items-center justify-between py-1">
                      <span className="text-muted-foreground text-xs">
                        {FEATURE_LABELS[feature]}
                      </span>
                      {plan.features?.[feature] ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Minus className="h-3.5 w-3.5 text-muted-foreground/40" />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {onSelectPlan && !isCurrent && isFixedOrFree && (
                <button
                  onClick={() => onSelectPlan(plan.key as OrganizationPlan, effectiveCycle)}
                  className="mt-4 w-full px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
                >
                  {idx > currentIdx ? "Passer à ce plan" : "Rétrograder"}
                </button>
              )}
              {!isFixedOrFree && !isCurrent && (
                <a
                  href="mailto:contact@teranga.events"
                  className="mt-4 block w-full px-4 py-2 border border-primary text-primary text-sm font-medium rounded-lg hover:bg-primary/5 transition-colors text-center"
                >
                  Contactez-nous
                </a>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
