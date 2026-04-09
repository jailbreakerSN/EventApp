"use client";

import { useState } from "react";
import Link from "next/link";
import { Calendar, QrCode, XCircle, RotateCcw, ListOrdered, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMyRegistrations, useCancelRegistration } from "@/hooks/use-registrations";
import { paymentsApi } from "@/lib/api-client";
import {
  Button,
  Badge,
  Card,
  formatDate,
  ConfirmDialog,
  getErrorMessage,
} from "@teranga/shared-ui";
import type { Registration } from "@teranga/shared-types";

const STATUS_LABELS: Record<
  string,
  { label: string; variant: "default" | "success" | "warning" | "destructive" | "outline" }
> = {
  confirmed: { label: "Confirm\u00e9", variant: "success" },
  pending: { label: "En attente", variant: "warning" },
  pending_payment: { label: "Paiement en attente", variant: "warning" },
  waitlisted: { label: "En liste d'attente", variant: "warning" },
  checked_in: { label: "Enregistr\u00e9", variant: "default" },
  cancelled: { label: "Annul\u00e9", variant: "destructive" },
  refund_requested: { label: "Remboursement demand\u00e9", variant: "warning" },
  refunded: { label: "Rembours\u00e9", variant: "outline" },
};

export default function MyEventsPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useMyRegistrations({ page, limit: 20 });
  const cancelMutation = useCancelRegistration();
  const queryClient = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [refundTarget, setRefundTarget] = useState<{
    registrationId: string;
    paymentId: string;
  } | null>(null);

  const registrations = (data as { data?: Registration[] })?.data as Registration[] | undefined;
  const meta = (data as { meta?: { total: number; totalPages: number } })?.meta;

  const refundMutation = useMutation({
    mutationFn: (paymentId: string) =>
      paymentsApi.refund(paymentId, "Demande de remboursement par le participant"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-registrations"] });
      toast.success("Demande de remboursement envoy\u00e9e");
    },
    onError: (err: unknown) => {
      const code = (err as { code?: string })?.code;
      const message = (err as { message?: string })?.message;
      toast.error(getErrorMessage(code, message));
    },
  });

  const handleCancel = async () => {
    if (!cancelTarget) return;
    try {
      await cancelMutation.mutateAsync(cancelTarget);
      toast.success("Inscription annul\u00e9e avec succ\u00e8s.");
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      const message = (err as { message?: string })?.message;
      toast.error(getErrorMessage(code, message));
    } finally {
      setCancelTarget(null);
    }
  };

  const handleRefund = async () => {
    if (!refundTarget) return;
    try {
      await refundMutation.mutateAsync(refundTarget.paymentId);
    } finally {
      setRefundTarget(null);
    }
  };

  /** Determine if a registration is eligible for a refund request */
  function canRequestRefund(reg: Registration): boolean {
    // Only confirmed registrations with a paid ticket can request refund
    // Exclude cancelled, refunded, or refund_requested statuses
    const nonRefundableStatuses = [
      "cancelled",
      "refunded",
      "refund_requested",
      "pending",
      "pending_payment",
      "waitlisted",
    ];
    if (nonRefundableStatuses.includes(reg.status)) return false;
    // Registration must have a payment associated (non-free ticket)
    const regRecord = reg as Record<string, unknown>;
    const paymentId = regRecord.paymentId as string | undefined;
    if (!paymentId) return false;
    return true;
  }

  function getPaymentId(reg: Registration): string | undefined {
    return (reg as Record<string, unknown>).paymentId as string | undefined;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold">Mes inscriptions</h1>
      <p className="mt-1 text-muted-foreground">
        {meta?.total !== undefined ? `${meta.total} inscription${meta.total > 1 ? "s" : ""}` : ""}
      </p>

      {isLoading && (
        <div className="mt-6 space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-4">
              <div className="animate-pulse flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-5 bg-muted rounded w-1/3"></div>
                    <div className="h-5 bg-muted rounded w-16"></div>
                  </div>
                  <div className="h-4 bg-muted rounded w-2/3"></div>
                </div>
                <div className="flex gap-2">
                  <div className="h-8 bg-muted rounded w-20"></div>
                  <div className="h-8 bg-muted rounded w-20"></div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-8 rounded-md bg-destructive/10 p-4 text-sm text-destructive">
          Impossible de charger vos inscriptions. Veuillez r\u00e9essayer.
        </div>
      )}

      {registrations && registrations.length === 0 && (
        <div className="mt-12 text-center">
          <Calendar className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-lg text-muted-foreground">Aucune inscription pour le moment.</p>
          <Link href="/events">
            <Button className="mt-4 bg-teranga-gold hover:bg-teranga-gold/90">
              D\u00e9couvrir les \u00e9v\u00e9nements
            </Button>
          </Link>
        </div>
      )}

      {registrations && registrations.length > 0 && (
        <div className="mt-6 space-y-4">
          {registrations.map((reg) => {
            const status = STATUS_LABELS[reg.status] ?? {
              label: reg.status,
              variant: "outline" as const,
            };
            const canCancel = ["confirmed", "pending"].includes(reg.status);
            const isWaitlisted = reg.status === "waitlisted";
            const eventTitle = (reg as Record<string, unknown>).eventTitle as string | undefined;
            const ticketTypeName = (reg as Record<string, unknown>).ticketTypeName as
              | string
              | undefined;
            const waitlistPosition = (reg as Record<string, unknown>).waitlistPosition as
              | number
              | undefined;
            const showRefund = canRequestRefund(reg);
            const paymentId = getPaymentId(reg);

            return (
              <Card
                key={reg.id}
                className={`p-4 ${isWaitlisted ? "border-amber-300 dark:border-amber-600" : ""}`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{eventTitle ?? reg.eventId}</h3>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Billet : {ticketTypeName ?? reg.ticketTypeId} · Inscrit le{" "}
                      {formatDate(reg.createdAt)}
                    </p>
                    {isWaitlisted && waitlistPosition && (
                      <p className="mt-1 flex items-center gap-1 text-sm font-medium text-amber-600 dark:text-amber-400">
                        <ListOrdered className="h-4 w-4" />
                        Position #{waitlistPosition}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    {reg.status === "confirmed" && reg.qrCodeValue && (
                      <Link href={`/my-events/${reg.id}/badge`}>
                        <Button variant="outline" size="sm">
                          <QrCode className="mr-1 h-4 w-4" />
                          Badge
                        </Button>
                      </Link>
                    )}
                    {showRefund && paymentId && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-amber-600 hover:text-amber-700 border-amber-300 hover:border-amber-400 dark:text-amber-400 dark:hover:text-amber-300 dark:border-amber-700 dark:hover:border-amber-600"
                        onClick={() => setRefundTarget({ registrationId: reg.id, paymentId })}
                        disabled={refundMutation.isPending}
                      >
                        <RotateCcw className="mr-1 h-4 w-4" />
                        Remboursement
                      </Button>
                    )}
                    {isWaitlisted && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-amber-600 hover:text-amber-700 border-amber-300 hover:border-amber-400 dark:text-amber-400 dark:hover:text-amber-300 dark:border-amber-700 dark:hover:border-amber-600"
                        onClick={() => setCancelTarget(reg.id)}
                        disabled={cancelMutation.isPending}
                      >
                        <LogOut className="mr-1 h-4 w-4" />
                        Quitter la liste d&apos;attente
                      </Button>
                    )}
                    {canCancel && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setCancelTarget(reg.id)}
                        disabled={cancelMutation.isPending}
                      >
                        <XCircle className="mr-1 h-4 w-4" />
                        Annuler
                      </Button>
                    )}
                    {reg.status === "cancelled" && (
                      <span className="text-sm text-muted-foreground italic">Annul\u00e9</span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}

          {meta && meta.totalPages > 1 && (
            <div className="flex justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Pr\u00e9c\u00e9dent
              </Button>
              <span className="flex items-center text-sm text-muted-foreground">
                Page {page} / {meta.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= meta.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Suivant
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Cancel confirmation dialog */}
      <ConfirmDialog
        open={cancelTarget !== null}
        onConfirm={handleCancel}
        onCancel={() => setCancelTarget(null)}
        title="Annuler l'inscription"
        description="\u00cates-vous s\u00fbr(e) de vouloir annuler cette inscription ? Cette action est irr\u00e9versible."
        confirmLabel="Oui, annuler"
        cancelLabel="Non, garder"
        variant="danger"
      />

      {/* Refund confirmation dialog */}
      <ConfirmDialog
        open={refundTarget !== null}
        onConfirm={handleRefund}
        onCancel={() => setRefundTarget(null)}
        title="Demander un remboursement"
        description="Le remboursement sera trait\u00e9 selon la politique de l'organisateur. Le d\u00e9lai de traitement est g\u00e9n\u00e9ralement de 5-10 jours ouvr\u00e9s."
        confirmLabel="Confirmer la demande"
        cancelLabel="Annuler"
        variant="default"
      />
    </div>
  );
}
