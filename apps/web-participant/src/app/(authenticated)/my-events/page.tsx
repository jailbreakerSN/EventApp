"use client";

import { useState } from "react";
import Link from "next/link";
import { Calendar, QrCode, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useMyRegistrations, useCancelRegistration } from "@/hooks/use-registrations";
import { Button, Badge, Spinner, Card, formatDate, ConfirmDialog, getErrorMessage } from "@teranga/shared-ui";
import type { Registration } from "@teranga/shared-types";

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "success" | "warning" | "destructive" | "outline" }> = {
  confirmed: { label: "Confirmé", variant: "success" },
  pending: { label: "En attente", variant: "warning" },
  waitlisted: { label: "Liste d'attente", variant: "outline" },
  checked_in: { label: "Enregistré", variant: "default" },
  cancelled: { label: "Annulé", variant: "destructive" },
};

export default function MyEventsPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useMyRegistrations({ page, limit: 20 });
  const cancelMutation = useCancelRegistration();
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  const registrations = (data as { data?: Registration[] })?.data as Registration[] | undefined;
  const meta = (data as { meta?: { total: number; totalPages: number } })?.meta;

  const handleCancel = async () => {
    if (!cancelTarget) return;
    try {
      await cancelMutation.mutateAsync(cancelTarget);
      toast.success("Inscription annulée avec succès.");
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      const message = (err as { message?: string })?.message;
      toast.error(getErrorMessage(code, message));
    } finally {
      setCancelTarget(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold">Mes inscriptions</h1>
      <p className="mt-1 text-muted-foreground">
        {meta?.total !== undefined ? `${meta.total} inscription${meta.total > 1 ? "s" : ""}` : ""}
      </p>

      {isLoading && (
        <div className="mt-12 flex justify-center"><Spinner size="lg" /></div>
      )}

      {error && (
        <div className="mt-8 rounded-md bg-destructive/10 p-4 text-sm text-destructive">
          Impossible de charger vos inscriptions. Veuillez réessayer.
        </div>
      )}

      {registrations && registrations.length === 0 && (
        <div className="mt-12 text-center">
          <Calendar className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-lg text-muted-foreground">Aucune inscription pour le moment.</p>
          <Link href="/events">
            <Button className="mt-4 bg-teranga-gold hover:bg-teranga-gold/90">
              Découvrir les événements
            </Button>
          </Link>
        </div>
      )}

      {registrations && registrations.length > 0 && (
        <div className="mt-6 space-y-4">
          {registrations.map((reg) => {
            const status = STATUS_LABELS[reg.status] ?? { label: reg.status, variant: "outline" as const };
            const canCancel = ["confirmed", "pending", "waitlisted"].includes(reg.status);
            const eventTitle = (reg as Record<string, unknown>).eventTitle as string | undefined;
            const ticketTypeName = (reg as Record<string, unknown>).ticketTypeName as string | undefined;

            return (
              <Card key={reg.id} className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{eventTitle ?? reg.eventId}</h3>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Billet : {ticketTypeName ?? reg.ticketTypeId} · Inscrit le {formatDate(reg.createdAt)}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    {reg.status === "confirmed" && reg.qrCodeValue && (
                      <Link href={`/my-events/${reg.id}/badge`}>
                        <Button variant="outline" size="sm">
                          <QrCode className="mr-1 h-4 w-4" />
                          Badge
                        </Button>
                      </Link>
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
                      <span className="text-sm text-muted-foreground italic">Annulé</span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}

          {meta && meta.totalPages > 1 && (
            <div className="flex justify-center gap-2 pt-4">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Précédent
              </Button>
              <span className="flex items-center text-sm text-muted-foreground">
                Page {page} / {meta.totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>
                Suivant
              </Button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={cancelTarget !== null}
        onConfirm={handleCancel}
        onCancel={() => setCancelTarget(null)}
        title="Annuler l'inscription"
        description="Êtes-vous sûr(e) de vouloir annuler cette inscription ? Cette action est irréversible."
        confirmLabel="Oui, annuler"
        cancelLabel="Non, garder"
        variant="danger"
      />
    </div>
  );
}
