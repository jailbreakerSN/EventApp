"use client";

import { useState } from "react";
import { Check, ArrowRight, Loader2 } from "lucide-react";
import { ConfirmDialog } from "@teranga/shared-ui";
import {
  type OrganizationPlan,
  type PlanFeature,
  PLAN_DISPLAY,
  PLAN_LIMITS,
} from "@teranga/shared-types";

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

function formatPrice(priceXof: number): string {
  if (priceXof === 0) return "Gratuit";
  return new Intl.NumberFormat("fr-SN", {
    style: "currency",
    currency: "XOF",
    maximumFractionDigits: 0,
  }).format(priceXof);
}

interface UpgradeDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  currentPlan: OrganizationPlan;
  targetPlan: OrganizationPlan;
}

export function UpgradeDialog({
  open,
  onClose,
  onConfirm,
  currentPlan,
  targetPlan,
}: UpgradeDialogProps) {
  const [loading, setLoading] = useState(false);

  const currentDisplay = PLAN_DISPLAY[currentPlan];
  const targetDisplay = PLAN_DISPLAY[targetPlan];

  const isUpgrade =
    ["free", "starter", "pro", "enterprise"].indexOf(targetPlan) >
    ["free", "starter", "pro", "enterprise"].indexOf(currentPlan);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  const description = isUpgrade
    ? `Vous passez de ${currentDisplay.name.fr} à ${targetDisplay.name.fr}. Les nouvelles fonctionnalités seront disponibles immédiatement.`
    : `Vous rétrogradez de ${currentDisplay.name.fr} à ${targetDisplay.name.fr}. Certaines fonctionnalités ne seront plus disponibles.`;

  return (
    <ConfirmDialog
      open={open}
      onCancel={onClose}
      onConfirm={handleConfirm}
      title={isUpgrade ? "Confirmer la mise à niveau" : "Confirmer le changement de plan"}
      description={description}
      confirmLabel={
        loading
          ? "Traitement..."
          : isUpgrade
            ? `Passer à ${targetDisplay.name.fr}`
            : `Rétrograder à ${targetDisplay.name.fr}`
      }
      cancelLabel="Annuler"
      variant={isUpgrade ? "default" : "danger"}
    />
  );
}

/** Standalone upgrade preview panel — used inside the billing page */
export function UpgradePreview({
  currentPlan,
  targetPlan,
  onConfirm,
  onCancel,
  isPending,
}: {
  currentPlan: OrganizationPlan;
  targetPlan: OrganizationPlan;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const currentDisplay = PLAN_DISPLAY[currentPlan];
  const targetDisplay = PLAN_DISPLAY[targetPlan];
  const currentFeatures = PLAN_LIMITS[currentPlan].features;
  const targetFeatures = PLAN_LIMITS[targetPlan].features;

  const gainedFeatures = (Object.keys(targetFeatures) as PlanFeature[]).filter(
    (f) => targetFeatures[f] && !currentFeatures[f],
  );
  const lostFeatures = (Object.keys(currentFeatures) as PlanFeature[]).filter(
    (f) => currentFeatures[f] && !targetFeatures[f],
  );

  const isUpgrade =
    ["free", "starter", "pro", "enterprise"].indexOf(targetPlan) >
    ["free", "starter", "pro", "enterprise"].indexOf(currentPlan);

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <h2 className="text-lg font-semibold text-foreground mb-4">
        {isUpgrade ? "Mise à niveau" : "Changement de plan"}
      </h2>

      {/* Transition visual */}
      <div className="flex items-center justify-center gap-4 mb-6 py-4 bg-muted/30 rounded-lg">
        <div className="text-center">
          <p className="text-xs text-muted-foreground mb-1">Actuel</p>
          <p className="font-semibold text-foreground">{currentDisplay.name.fr}</p>
          <p className="text-sm text-muted-foreground">
            {formatPrice(currentDisplay.priceXof)}/mois
          </p>
        </div>
        <ArrowRight className="h-5 w-5 text-primary" />
        <div className="text-center">
          <p className="text-xs text-primary mb-1 font-medium">Nouveau</p>
          <p className="font-semibold text-primary">{targetDisplay.name.fr}</p>
          <p className="text-sm text-foreground font-medium">
            {formatPrice(targetDisplay.priceXof)}/mois
          </p>
        </div>
      </div>

      {/* Gained features */}
      {gainedFeatures.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wider mb-2">
            Fonctionnalités gagnées
          </p>
          <div className="space-y-1.5">
            {gainedFeatures.map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm">
                <Check className="h-3.5 w-3.5 text-green-600" />
                <span>{FEATURE_LABELS[f]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lost features (downgrade) */}
      {lostFeatures.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wider mb-2">
            Fonctionnalités perdues
          </p>
          <div className="space-y-1.5">
            {lostFeatures.map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="h-3.5 w-3.5 text-red-400 text-center leading-none">-</span>
                <span>{FEATURE_LABELS[f]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MVP notice */}
      <p className="text-xs text-muted-foreground mb-4 bg-muted/50 rounded-lg p-3">
        Pour le moment, le changement de plan est instantané et sans paiement. L&apos;intégration
        des paiements (Wave, Orange Money) arrive bientôt.
      </p>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={onConfirm}
          disabled={isPending}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
            isUpgrade
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-red-600 text-white hover:bg-red-700"
          }`}
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isUpgrade ? "Confirmer la mise à niveau" : "Confirmer la rétrogradation"}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
