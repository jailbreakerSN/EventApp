"use client";

import { Check, X, Minus, Loader2 } from "lucide-react";
import {
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

function formatPrice(plan: Plan): string {
  switch (plan.pricingModel ?? (plan.priceXof > 0 ? "fixed" : "free")) {
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

interface PlanComparisonTableProps {
  currentPlan: OrganizationPlan;
  onSelectPlan?: (plan: OrganizationPlan) => void;
}

export function PlanComparisonTable({ currentPlan, onSelectPlan }: PlanComparisonTableProps) {
  const { data, isLoading, isError } = usePlansCatalog();
  const plans = (data?.data ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const currentIdx = plans.findIndex((p) => p.key === currentPlan);
  const features = Object.keys(FEATURE_LABELS) as PlanFeature[];

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
                const isFixedOrFree =
                  (plan.pricingModel ?? (plan.priceXof > 0 ? "fixed" : "free")) !== "custom";
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
                      <p className="text-lg font-bold text-primary mt-1">{formatPrice(plan)}</p>
                      {plan.priceXof > 0 && isFixedOrFree && (
                        <p className="text-xs text-muted-foreground">/ mois</p>
                      )}
                      {onSelectPlan && !isCurrent && isFixedOrFree && (
                        <button
                          onClick={() => onSelectPlan(plan.key as OrganizationPlan)}
                          className="mt-3 w-full px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors"
                        >
                          {idx > currentIdx ? "Passer à ce plan" : "Rétrograder"}
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
          const isFixedOrFree =
            (plan.pricingModel ?? (plan.priceXof > 0 ? "fixed" : "free")) !== "custom";

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
                  <p className="text-lg font-bold text-primary">{formatPrice(plan)}</p>
                  {plan.priceXof > 0 && isFixedOrFree && (
                    <p className="text-xs text-muted-foreground">/ mois</p>
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
                  onClick={() => onSelectPlan(plan.key as OrganizationPlan)}
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
