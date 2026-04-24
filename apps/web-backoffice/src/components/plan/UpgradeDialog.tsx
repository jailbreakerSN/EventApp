"use client";

import { useState } from "react";
import { Check, ArrowRight, Loader2, Tag } from "lucide-react";
import { ConfirmDialog } from "@teranga/shared-ui";
import {
  type OrganizationPlan,
  type PlanFeature,
  type Plan,
  type PlanFeatures,
  type ValidateCouponResponse,
} from "@teranga/shared-types";
import { usePlansCatalogMap, getPlanDisplay } from "@/hooks/use-plans-catalog";
import { adminApi } from "@/lib/api-client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

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

function formatPlanCost(display: { priceXof: number; pricingModel: string }): string {
  switch (display.pricingModel) {
    case "free":
      return "Gratuit";
    case "custom":
      return "Sur mesure";
    case "metered":
      return display.priceXof > 0
        ? new Intl.NumberFormat("fr-SN", {
            style: "currency",
            currency: "XOF",
            maximumFractionDigits: 0,
          }).format(display.priceXof) + " + à l'usage"
        : "À l'usage";
    case "fixed":
    default:
      return new Intl.NumberFormat("fr-SN", {
        style: "currency",
        currency: "XOF",
        maximumFractionDigits: 0,
      }).format(display.priceXof);
  }
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
  const { map: catalog } = usePlansCatalogMap();

  const currentDisplay = getPlanDisplay(currentPlan, catalog);
  const targetDisplay = getPlanDisplay(targetPlan, catalog);

  const isUpgrade = isUpgradeDirection(currentPlan, targetPlan, catalog);

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

function isUpgradeDirection(current: string, target: string, catalog: Map<string, Plan>): boolean {
  const currentSort = catalog.get(current)?.sortOrder;
  const targetSort = catalog.get(target)?.sortOrder;
  if (currentSort !== undefined && targetSort !== undefined) {
    return targetSort > currentSort;
  }
  // Fallback to legacy enum order when the catalog hasn't loaded.
  const order = ["free", "starter", "pro", "enterprise"];
  return order.indexOf(target) > order.indexOf(current);
}

/** Standalone upgrade preview panel — used inside the billing page */
export function UpgradePreview({
  currentPlan,
  targetPlan,
  targetCycle,
  onConfirm,
  onCancel,
  isPending,
}: {
  currentPlan: OrganizationPlan;
  targetPlan: OrganizationPlan;
  /** Billing cycle the user picked — needed to validate cycle-scoped coupons. */
  targetCycle?: "monthly" | "annual";
  onConfirm: (opts?: { couponCode?: string }) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const { map: catalog } = usePlansCatalogMap();
  const { user } = useAuth();
  const currentDisplay = getPlanDisplay(currentPlan, catalog);
  const targetDisplay = getPlanDisplay(targetPlan, catalog);
  const currentFeatures: Partial<PlanFeatures> =
    catalog.get(currentPlan)?.features ?? ({} as PlanFeatures);
  const targetFeatures: Partial<PlanFeatures> =
    catalog.get(targetPlan)?.features ?? ({} as PlanFeatures);

  const featureKeys = Object.keys(FEATURE_LABELS) as PlanFeature[];
  const gainedFeatures = featureKeys.filter((f) => targetFeatures[f] && !currentFeatures[f]);
  const lostFeatures = featureKeys.filter((f) => currentFeatures[f] && !targetFeatures[f]);

  const isUpgrade = isUpgradeDirection(currentPlan, targetPlan, catalog);

  // ── Coupon preview state (upgrades only) ──────────────────────────────
  // We never auto-validate — user types + clicks Valider, we show a preview.
  // The preview is cleared when the code is cleared. The real apply path
  // runs again inside the upgrade transaction (the preview is an optimistic
  // UX layer only; server owns the truth).
  const [couponCode, setCouponCode] = useState("");
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [couponPreview, setCouponPreview] = useState<ValidateCouponResponse | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const targetPlanDoc = catalog.get(targetPlan);

  const validateCoupon = async () => {
    const orgId = user?.organizationId;
    if (!orgId || !targetPlanDoc || !couponCode.trim()) return;
    setValidatingCoupon(true);
    setCouponError(null);
    try {
      const res = await adminApi.validateCoupon(targetPlanDoc.id, orgId, {
        code: couponCode.trim().toUpperCase(),
        cycle: targetCycle,
      });
      setCouponPreview(res.data);
    } catch (err: unknown) {
      setCouponError(err instanceof Error ? err.message : "Coupon invalide");
      setCouponPreview(null);
    } finally {
      setValidatingCoupon(false);
    }
  };

  const clearCoupon = () => {
    setCouponCode("");
    setCouponPreview(null);
    setCouponError(null);
  };

  const handleConfirmClick = () => {
    // Pass the code only if the preview validated — a bad code would fail
    // server-side anyway, but a clean pre-check avoids burning a round-trip.
    if (couponPreview) {
      onConfirm({ couponCode: couponPreview.code });
    } else if (couponCode.trim()) {
      toast.error("Veuillez valider le coupon avant de confirmer.");
    } else {
      onConfirm();
    }
  };

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
          <p className="text-sm text-muted-foreground">{formatPlanCost(currentDisplay)}</p>
        </div>
        <ArrowRight className="h-5 w-5 text-primary" />
        <div className="text-center">
          <p className="text-xs text-primary mb-1 font-medium">Nouveau</p>
          <p className="font-semibold text-primary">{targetDisplay.name.fr}</p>
          <p className="text-sm text-foreground font-medium">{formatPlanCost(targetDisplay)}</p>
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

      {/* Coupon input — upgrades only (downgrades never apply a discount). */}
      {isUpgrade && (
        <div className="mb-4 border border-border rounded-lg p-3">
          <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1">
            <Tag className="h-3.5 w-3.5 text-primary" />
            Code promo
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
              placeholder="LAUNCH2026"
              disabled={!!couponPreview}
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono disabled:opacity-60"
              aria-label="Code promo"
            />
            {couponPreview ? (
              <button
                type="button"
                onClick={clearCoupon}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Retirer
              </button>
            ) : (
              <button
                type="button"
                onClick={validateCoupon}
                disabled={!couponCode.trim() || validatingCoupon}
                className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-background px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 disabled:opacity-50 transition-colors"
              >
                {validatingCoupon && <Loader2 className="h-3 w-3 animate-spin" />}
                Valider
              </button>
            )}
          </div>
          {couponError && (
            <p className="mt-2 text-xs text-destructive">{couponError}</p>
          )}
          {couponPreview && (
            <div className="mt-2 text-xs space-y-0.5">
              <p className="text-green-700 dark:text-green-400 font-medium">
                Coupon valide — remise appliquée à la confirmation.
              </p>
              <p className="text-muted-foreground">
                Prix barré :{" "}
                <span className="line-through">
                  {couponPreview.originalPriceXof.toLocaleString("fr-FR")} XOF
                </span>{" "}
                · Prix final :{" "}
                <span className="font-semibold text-foreground">
                  {couponPreview.finalPriceXof.toLocaleString("fr-FR")} XOF
                </span>{" "}
                <span className="text-green-700 dark:text-green-400">
                  (−{couponPreview.discountXof.toLocaleString("fr-FR")} XOF)
                </span>
              </p>
            </div>
          )}
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
          onClick={handleConfirmClick}
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
