"use client";

import { Check, X, Minus } from "lucide-react";
import {
  type OrganizationPlan,
  type PlanFeature,
  PLAN_DISPLAY,
  PLAN_LIMITS,
} from "@teranga/shared-types";
import { cn } from "@/lib/utils";

const PLAN_ORDER: OrganizationPlan[] = ["free", "starter", "pro", "enterprise"];

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

const LIMIT_ROWS: { key: string; label: string; getValue: (plan: OrganizationPlan) => string }[] = [
  {
    key: "events",
    label: "Événements actifs",
    getValue: (plan) => {
      const v = PLAN_LIMITS[plan].maxEvents;
      return isFinite(v) ? String(v) : "Illimité";
    },
  },
  {
    key: "participants",
    label: "Participants / événement",
    getValue: (plan) => {
      const v = PLAN_LIMITS[plan].maxParticipantsPerEvent;
      return isFinite(v) ? String(v) : "Illimité";
    },
  },
  {
    key: "members",
    label: "Membres de l'équipe",
    getValue: (plan) => {
      const v = PLAN_LIMITS[plan].maxMembers;
      return isFinite(v) ? String(v) : "Illimité";
    },
  },
];

function formatPrice(priceXof: number): string {
  if (priceXof === 0) return "Gratuit";
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
  const features = Object.keys(FEATURE_LABELS) as PlanFeature[];

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-4 pr-4 font-medium text-muted-foreground w-1/5" />
              {PLAN_ORDER.map((plan) => {
                const display = PLAN_DISPLAY[plan];
                const isCurrent = plan === currentPlan;
                return (
                  <th key={plan} className="py-4 px-3 text-center w-1/5">
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
                      <p className="font-semibold text-foreground">{display.name.fr}</p>
                      <p className="text-lg font-bold text-primary mt-1">
                        {plan === "enterprise" ? "Sur mesure" : formatPrice(display.priceXof)}
                      </p>
                      {display.priceXof > 0 && (
                        <p className="text-xs text-muted-foreground">/ mois</p>
                      )}
                      {onSelectPlan && plan !== currentPlan && plan !== "enterprise" && (
                        <button
                          onClick={() => onSelectPlan(plan)}
                          className="mt-3 w-full px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors"
                        >
                          {PLAN_ORDER.indexOf(plan) > PLAN_ORDER.indexOf(currentPlan)
                            ? "Passer à ce plan"
                            : "Rétrograder"}
                        </button>
                      )}
                      {plan === "enterprise" && plan !== currentPlan && (
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
            {/* Limits section */}
            <tr>
              <td
                colSpan={5}
                className="pt-6 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider"
              >
                Limites
              </td>
            </tr>
            {LIMIT_ROWS.map((row) => (
              <tr key={row.key} className="border-b border-border/50">
                <td className="py-3 pr-4 text-muted-foreground">{row.label}</td>
                {PLAN_ORDER.map((plan) => (
                  <td key={plan} className="py-3 px-3 text-center font-medium">
                    {row.getValue(plan)}
                  </td>
                ))}
              </tr>
            ))}

            {/* Features section */}
            <tr>
              <td
                colSpan={5}
                className="pt-6 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider"
              >
                Fonctionnalités
              </td>
            </tr>
            {features.map((feature) => (
              <tr key={feature} className="border-b border-border/50">
                <td className="py-3 pr-4 text-muted-foreground">{FEATURE_LABELS[feature]}</td>
                {PLAN_ORDER.map((plan) => {
                  const enabled = PLAN_LIMITS[plan].features[feature];
                  return (
                    <td key={plan} className="py-3 px-3 text-center">
                      {enabled ? (
                        <Check className="h-4 w-4 text-green-600 mx-auto" />
                      ) : (
                        <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-4">
        {PLAN_ORDER.map((plan) => {
          const display = PLAN_DISPLAY[plan];
          const limits = PLAN_LIMITS[plan];
          const isCurrent = plan === currentPlan;

          return (
            <div
              key={plan}
              className={cn(
                "rounded-xl border p-5",
                isCurrent ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-semibold text-foreground">{display.name.fr}</p>
                  <p className="text-lg font-bold text-primary">
                    {plan === "enterprise" ? "Sur mesure" : formatPrice(display.priceXof)}
                  </p>
                  {display.priceXof > 0 && <p className="text-xs text-muted-foreground">/ mois</p>}
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
                      {limits.features[feature] ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Minus className="h-3.5 w-3.5 text-muted-foreground/40" />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {onSelectPlan && !isCurrent && plan !== "enterprise" && (
                <button
                  onClick={() => onSelectPlan(plan)}
                  className="mt-4 w-full px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
                >
                  {PLAN_ORDER.indexOf(plan) > PLAN_ORDER.indexOf(currentPlan)
                    ? "Passer à ce plan"
                    : "Rétrograder"}
                </button>
              )}
              {plan === "enterprise" && !isCurrent && (
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
