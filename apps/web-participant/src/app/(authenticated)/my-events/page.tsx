"use client";

import { useState } from "react";
import Link from "next/link";
import { Calendar, QrCode, XCircle, RotateCcw, ListOrdered, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useMyRegistrations, useCancelRegistration } from "@/hooks/use-registrations";
import { paymentsApi } from "@/lib/api-client";
import {
  Button,
  Badge,
  Card,
  EmptyState,
  formatDate,
  ConfirmDialog,
  getErrorMessage,
} from "@teranga/shared-ui";
import type { Registration } from "@teranga/shared-types";

function intlLocale(locale: string): string {
  switch (locale) {
    case "fr":
      return "fr-SN";
    case "en":
      return "en-SN";
    case "wo":
      return "wo-SN";
    default:
      return locale;
  }
}

type StatusKey =
  | "confirmed"
  | "pending"
  | "pending_payment"
  | "waitlisted"
  | "checked_in"
  | "cancelled"
  | "refund_requested"
  | "refunded";

const STATUS_VARIANTS: Record<
  StatusKey,
  "default" | "success" | "warning" | "destructive" | "outline"
> = {
  confirmed: "success",
  pending: "warning",
  pending_payment: "warning",
  waitlisted: "warning",
  checked_in: "default",
  cancelled: "destructive",
  refund_requested: "warning",
  refunded: "outline",
};

export default function MyEventsPage() {
  const t = useTranslations("myEvents");
  const locale = useLocale();
  const regional = intlLocale(locale);
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useMyRegistrations({ page, limit: 20 });
  const cancelMutation = useCancelRegistration();
  const queryClient = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [refundTarget, setRefundTarget] = useState<{
    registrationId: string;
    paymentId: string;
  } | null>(null);

  const registrations = data?.data;
  const meta = data?.meta;

  const refundMutation = useMutation({
    mutationFn: (paymentId: string) => paymentsApi.refund(paymentId, t("refundReason")),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-registrations"] });
      toast.success(t("refundRequested"));
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
      toast.success(t("cancelledSuccess"));
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

  type RegistrationWithExtras = Registration & {
    paymentId?: string;
    waitlistPosition?: number;
  };

  function canRequestRefund(reg: RegistrationWithExtras): boolean {
    const nonRefundableStatuses = [
      "cancelled",
      "refunded",
      "refund_requested",
      "pending",
      "pending_payment",
      "waitlisted",
    ];
    if (nonRefundableStatuses.includes(reg.status)) return false;
    if (!reg.paymentId) return false;
    return true;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="mt-1 text-muted-foreground">
        {meta?.total !== undefined ? t("countLabel", { count: meta.total }) : ""}
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
          {t("loadError")}
        </div>
      )}

      {registrations && registrations.length === 0 && (
        <EmptyState
          icon={Calendar}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <Link href="/events">
              <Button className="bg-teranga-gold hover:bg-teranga-gold/90">
                {t("discoverCta")}
              </Button>
            </Link>
          }
        />
      )}

      {registrations && registrations.length > 0 && (
        <div className="mt-6 space-y-4">
          {registrations.map((rawReg) => {
            const reg = rawReg as RegistrationWithExtras;
            const statusKey =
              (reg.status as StatusKey) in STATUS_VARIANTS ? (reg.status as StatusKey) : null;
            const statusLabel = statusKey ? t(`status.${statusKey}` as const) : reg.status;
            const statusVariant = statusKey ? STATUS_VARIANTS[statusKey] : "outline";
            const canCancel = ["confirmed", "pending"].includes(reg.status);
            const isWaitlisted = reg.status === "waitlisted";
            const showRefund = canRequestRefund(reg);

            return (
              <Card
                key={reg.id}
                className={`p-4 ${isWaitlisted ? "border-amber-300 dark:border-amber-600" : ""}`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{reg.eventTitle ?? reg.eventId}</h3>
                      <Badge variant={statusVariant}>{statusLabel}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("ticketPrefix")} : {reg.ticketTypeName ?? reg.ticketTypeId} ·{" "}
                      {t("registeredOn")} {formatDate(reg.createdAt, regional)}
                    </p>
                    {isWaitlisted && reg.waitlistPosition && (
                      <p className="mt-1 flex items-center gap-1 text-sm font-medium text-amber-600 dark:text-amber-400">
                        <ListOrdered className="h-4 w-4" />
                        {t("waitlistPosition", { n: reg.waitlistPosition })}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    {reg.status === "confirmed" && reg.qrCodeValue && (
                      <Link href={`/my-events/${reg.id}/badge`}>
                        <Button variant="outline" size="sm">
                          <QrCode className="mr-1 h-4 w-4" />
                          {t("badge")}
                        </Button>
                      </Link>
                    )}
                    {showRefund && reg.paymentId && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-amber-600 hover:text-amber-700 border-amber-300 hover:border-amber-400 dark:text-amber-400 dark:hover:text-amber-300 dark:border-amber-700 dark:hover:border-amber-600"
                        onClick={() =>
                          setRefundTarget({ registrationId: reg.id, paymentId: reg.paymentId! })
                        }
                        disabled={refundMutation.isPending}
                      >
                        <RotateCcw className="mr-1 h-4 w-4" />
                        {t("refund")}
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
                        {t("leaveWaitlist")}
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
                        {t("cancel")}
                      </Button>
                    )}
                    {reg.status === "cancelled" && (
                      <span className="text-sm text-muted-foreground italic">{t("cancelled")}</span>
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
                {t("paginationPrev")}
              </Button>
              <span className="flex items-center text-sm text-muted-foreground">
                {t("paginationOf", { page, total: meta.totalPages })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= meta.totalPages}
                onClick={() => setPage(page + 1)}
              >
                {t("paginationNext")}
              </Button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={cancelTarget !== null}
        onConfirm={handleCancel}
        onCancel={() => setCancelTarget(null)}
        title={t("cancelDialog.title")}
        description={t("cancelDialog.description")}
        confirmLabel={t("cancelDialog.confirm")}
        cancelLabel={t("cancelDialog.cancel")}
        variant="danger"
      />

      <ConfirmDialog
        open={refundTarget !== null}
        onConfirm={handleRefund}
        onCancel={() => setRefundTarget(null)}
        title={t("refundDialog.title")}
        description={t("refundDialog.description")}
        confirmLabel={t("refundDialog.confirm")}
        cancelLabel={t("refundDialog.cancel")}
        variant="default"
      />
    </div>
  );
}
