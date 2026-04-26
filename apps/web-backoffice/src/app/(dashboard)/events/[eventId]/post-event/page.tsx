"use client";

/**
 * Organizer overhaul — Phase O9.
 *
 * Post-event surface — the J+1 "rapport + finance + cohorte" page.
 * Layout (mobile-stacks → desktop side-by-side):
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ Header :  title · isFinal pill · toolbar (PDF / CSV /   │
 *   │           Demander le versement)                         │
 *   ├─────────────────────────────────────────────────────────┤
 *   │ <PostEventReportCards/>  (Présence / Comms / Finances /  │
 *   │  Démographies)                                           │
 *   ├─────────────────────────────────────────────────────────┤
 *   │ <ReconciliationTable/>  (matrice par moyen × statut +    │
 *   │  total ligne)                                            │
 *   └─────────────────────────────────────────────────────────┘
 *
 * The page is wrapped by the standard event chrome (4-section IA from
 * O4) so the breadcrumb + section tabs stay visible. We do NOT bypass
 * the chrome here — unlike `/live`, post-event is a calm, multi-tab
 * dashboard, not a control room.
 */

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Button, Card, CardContent, InlineErrorBanner } from "@teranga/shared-ui";
import { FileDown, BadgeDollarSign, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  useGeneratePostEventPdf,
  usePostEventReport,
  useReconciliation,
  useRequestPayout,
} from "@/hooks/use-post-event";
import { useErrorHandler, type ResolvedError } from "@/hooks/use-error-handler";
import { PostEventReportCards } from "@/components/post-event/PostEventReportCards";
import { ReconciliationTable } from "@/components/post-event/ReconciliationTable";
import { CohortExportButton } from "@/components/post-event/CohortExportButton";
import { formatXof } from "@/components/post-event/helpers";
import { cn } from "@/lib/utils";

export default function EventPostEventPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { data: report, isLoading: reportLoading } = usePostEventReport(eventId);
  const { data: reconciliation, isLoading: reconLoading } = useReconciliation(eventId);
  const generatePdf = useGeneratePostEventPdf(eventId ?? "");
  const requestPayout = useRequestPayout(eventId ?? "");
  const { resolve: resolveError } = useErrorHandler();
  const [error, setError] = useState<ResolvedError | null>(null);

  const isFinal = report?.isFinal ?? false;
  const payoutAmount = report?.financial.payoutAmount ?? 0;
  const hasPayoutAmount = payoutAmount > 0;

  const handleDownloadPdf = async () => {
    setError(null);
    try {
      const result = await generatePdf.mutateAsync();
      // Open the signed URL in a new tab — the browser handles the
      // download dialog. We don't trigger an `<a download>` here
      // because Cloud Storage's V4 signed URLs already set the right
      // content-type and the browser respects the header.
      window.open(result.pdfURL, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(resolveError(err));
    }
  };

  const handleRequestPayout = async () => {
    setError(null);
    try {
      const payout = await requestPayout.mutateAsync();
      toast.success(`Versement créé · ${formatXof(payout.netAmount)}`, {
        description: "Le suivi du virement est disponible dans Finances.",
      });
    } catch (err) {
      setError(resolveError(err));
    }
  };

  const headerStatus = useMemo(() => {
    if (!report) return null;
    return report.isFinal ? "Événement clos" : "Événement en cours";
  }, [report]);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Rapport post-événement
            {headerStatus && (
              <span
                className={cn(
                  "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full",
                  isFinal
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                )}
              >
                {headerStatus}
              </span>
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            Présence, communications, finances. Téléchargez le rapport PDF ou la liste cohorte pour
            vos campagnes.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadPdf}
            disabled={generatePdf.isPending}
          >
            <FileDown className="h-4 w-4 mr-1.5" aria-hidden="true" />
            {generatePdf.isPending ? "Génération…" : "Télécharger le PDF"}
          </Button>
          <CohortExportButton
            eventId={eventId ?? ""}
            isFinal={isFinal}
            onError={(e) => setError(e)}
          />
          <Button
            size="sm"
            onClick={handleRequestPayout}
            disabled={requestPayout.isPending || !hasPayoutAmount}
            title={!hasPayoutAmount ? "Aucun montant à verser pour le moment" : undefined}
          >
            <BadgeDollarSign className="h-4 w-4 mr-1.5" aria-hidden="true" />
            {requestPayout.isPending
              ? "Création…"
              : hasPayoutAmount
                ? `Demander ${formatXof(payoutAmount)}`
                : "Demander le versement"}
          </Button>
        </div>
      </header>

      {!isFinal && (
        <div className="rounded-md bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 p-3 text-xs flex items-start gap-2 text-amber-800 dark:text-amber-300">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            L&apos;événement n&apos;est pas encore terminé. Les chiffres de no-show et le calcul de
            versement seront définitifs après la date de fin.
          </span>
        </div>
      )}

      {error && (
        <InlineErrorBanner
          title={error.title}
          description={error.description}
          onDismiss={() => setError(null)}
          dismissLabel="Fermer"
        />
      )}

      <PostEventReportCards report={report} isLoading={reportLoading} />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Rapprochement financier
        </h3>
        <ReconciliationTable data={reconciliation} isLoading={reconLoading} />
        {!report?.financial && !reportLoading && (
          <Card>
            <CardContent className="p-4 text-xs text-muted-foreground">
              Pas encore de paiement enregistré pour cet événement.
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
