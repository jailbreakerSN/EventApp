"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Calendar,
  Check,
  ListOrdered,
  LogOut,
  QrCode,
  RotateCcw,
  Settings,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useMyRegistrations, useCancelRegistration } from "@/hooks/use-registrations";
import { useAuth } from "@/hooks/use-auth";
import { paymentsApi } from "@/lib/api-client";
import {
  Button,
  Card,
  ConfirmDialog,
  EditorialHero,
  EmptyState,
  EmptyStateEditorial,
  formatDate,
  getErrorMessage,
  StatusPill,
  type StatusPillTone,
} from "@teranga/shared-ui";
import type { Registration } from "@teranga/shared-types";
import { getCoverGradient } from "@/lib/cover-gradient";
import { intlLocale } from "@/lib/intl-locale";

type StatusKey =
  | "confirmed"
  | "pending"
  | "pending_payment"
  | "waitlisted"
  | "checked_in"
  | "cancelled"
  | "refund_requested"
  | "refunded";

const STATUS_TONES: Record<StatusKey, StatusPillTone> = {
  confirmed: "success",
  pending: "warning",
  pending_payment: "warning",
  waitlisted: "warning",
  checked_in: "info",
  cancelled: "clay",
  refund_requested: "warning",
  refunded: "neutral",
};

type TabId = "upcoming" | "past" | "saved";

export default function MyEventsPage() {
  const t = useTranslations("myEvents");
  const locale = useLocale();
  const regional = intlLocale(locale);
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<TabId>("upcoming");
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

  // Partition by rough "upcoming" vs "past". Registration has no event
  // end-date denormalized, so we bucket by status: checked-in registrations
  // are treated as past, everything else (confirmed / pending / waitlisted
  // / refunded / cancelled) stays on the upcoming tab. Saved events are a
  // future feature — the tab is rendered for parity with the prototype.
  const upcoming = (registrations ?? []).filter((r) => r.status !== "checked_in");
  const past = (registrations ?? []).filter((r) => r.status === "checked_in");

  const firstName = (user?.displayName ?? user?.email ?? "").split(" ")[0];

  return (
    <div className="mx-auto max-w-7xl px-6 pt-10 pb-20 lg:px-8">
      {/* Editorial hero — shared-ui EditorialHero (default variant) */}
      <EditorialHero
        className="mb-7"
        kicker={t("kicker", { name: firstName })}
        title={t("headline")}
        lead={
          meta?.total !== undefined
            ? t("countLabelWithPast", { count: upcoming.length, past: past.length })
            : undefined
        }
        actions={
          <div className="flex gap-2">
            <Link href="/settings">
              <Button variant="outline" className="rounded-full">
                <Settings className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t("settings")}
              </Button>
            </Link>
            <Link href="/events">
              <Button className="rounded-full bg-teranga-navy text-white hover:bg-teranga-navy/90 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light">
                {t("browseCta")}
                <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Button>
            </Link>
          </div>
        }
      />

      {/* Tab bar */}
      <div role="tablist" aria-label={t("title")} className="mb-8 flex gap-1 border-b">
        {[
          { id: "upcoming" as const, label: t("tabs.upcoming"), count: upcoming.length },
          { id: "past" as const, label: t("tabs.past"), count: past.length },
          { id: "saved" as const, label: t("tabs.saved"), count: 0 },
        ].map((ti) => {
          const active = tab === ti.id;
          return (
            <button
              key={ti.id}
              role="tab"
              aria-selected={active}
              aria-controls={`panel-${ti.id}`}
              onClick={() => setTab(ti.id)}
              className={`-mb-px px-4 py-3 text-sm font-semibold transition-colors ${
                active
                  ? "border-b-2 border-teranga-navy text-foreground dark:border-teranga-gold"
                  : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {ti.label}
              <span className="ml-1.5 font-medium text-muted-foreground">{ti.count}</span>
            </button>
          );
        })}
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-0 overflow-hidden">
              <div className="animate-pulse grid grid-cols-[220px_1fr_auto] gap-0">
                <div className="h-[180px] bg-muted" />
                <div className="space-y-3 p-6">
                  <div className="h-4 bg-muted rounded w-1/3" />
                  <div className="h-6 bg-muted rounded w-2/3" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                </div>
                <div className="space-y-2 p-5">
                  <div className="h-9 bg-muted rounded w-28" />
                  <div className="h-8 bg-muted rounded w-28" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-card bg-destructive/10 p-4 text-sm text-destructive">
          {t("loadError")}
        </div>
      )}

      {/* Upcoming panel */}
      {tab === "upcoming" && (
        <div role="tabpanel" id="panel-upcoming" className="flex flex-col gap-4">
          {registrations && upcoming.length === 0 && !isLoading && (
            <EmptyState
              icon={Calendar}
              title={t("emptyTitle")}
              description={t("emptyDescription")}
              action={
                <Link href="/events">
                  <Button className="rounded-full bg-teranga-navy text-white hover:bg-teranga-navy/90 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light">
                    {t("discoverCta")}
                  </Button>
                </Link>
              }
            />
          )}
          {upcoming.map((rawReg) => {
            const reg = rawReg as RegistrationWithExtras;
            return (
              <UpcomingRow
                key={reg.id}
                reg={reg}
                regional={regional}
                t={t}
                canCancel={["confirmed", "pending"].includes(reg.status)}
                isWaitlisted={reg.status === "waitlisted"}
                showRefund={canRequestRefund(reg)}
                onCancel={() => setCancelTarget(reg.id)}
                onRefund={() => {
                  if (reg.paymentId) {
                    setRefundTarget({ registrationId: reg.id, paymentId: reg.paymentId });
                  }
                }}
                isCancelling={cancelMutation.isPending}
                isRefunding={refundMutation.isPending}
              />
            );
          })}
        </div>
      )}

      {/* Past panel */}
      {tab === "past" && (
        <div role="tabpanel" id="panel-past">
          {past.length === 0 ? (
            <EmptyStateEditorial
              title={t("pastEmptyTitle")}
              description={t("pastEmptyDescription")}
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {past.map((rawReg) => {
                const reg = rawReg as RegistrationWithExtras;
                const gradient = getCoverGradient(reg.eventId).bg;
                const statusKey =
                  (reg.status as StatusKey) in STATUS_TONES ? (reg.status as StatusKey) : null;
                const statusTone: StatusPillTone = statusKey
                  ? STATUS_TONES[statusKey]
                  : "neutral";
                const statusLabel = statusKey ? t(`status.${statusKey}` as const) : reg.status;
                return (
                  <article key={reg.id} className="overflow-hidden rounded-card border bg-card">
                    <div
                      aria-hidden="true"
                      className="teranga-cover relative h-[140px]"
                      style={{ background: gradient }}
                    >
                      <div className="absolute right-3 top-3">
                        <StatusPill
                          tone={statusTone}
                          label={statusLabel}
                          icon={
                            reg.status === "checked_in" ? (
                              <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                            ) : undefined
                          }
                        />
                      </div>
                    </div>
                    <div className="p-5">
                      <p className="font-mono-kicker text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                        {formatDate(reg.createdAt, regional)}
                      </p>
                      <h3 className="font-serif-display mt-1.5 text-lg font-semibold tracking-[-0.015em]">
                        {reg.eventTitle ?? reg.eventId}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {reg.ticketTypeName ?? reg.ticketTypeId}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Saved panel — placeholder until the feature lands */}
      {tab === "saved" && (
        <div role="tabpanel" id="panel-saved">
          <EmptyStateEditorial
            title={t("savedEmptyTitle")}
            description={t("savedEmptyDescription")}
            action={
              <Link href="/events">
                <Button className="rounded-full bg-teranga-navy text-white hover:bg-teranga-navy/90 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light">
                  {t("discoverCta")}
                </Button>
              </Link>
            }
          />
        </div>
      )}

      {/* Pagination */}
      {meta && meta.totalPages > 1 && tab === "upcoming" && (
        <div className="mt-8 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="rounded-full"
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
            className="rounded-full"
          >
            {t("paginationNext")}
          </Button>
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

// Editorial upcoming row — 220px cover column + main content + action column.
// Cover gradient rotates per event.id via getCoverGradient.
function UpcomingRow({
  reg,
  regional,
  t,
  canCancel,
  isWaitlisted,
  showRefund,
  onCancel,
  onRefund,
  isCancelling,
  isRefunding,
}: {
  reg: Registration & { paymentId?: string; waitlistPosition?: number };
  regional: string;
  t: ReturnType<typeof useTranslations<"myEvents">>;
  canCancel: boolean;
  isWaitlisted: boolean;
  showRefund: boolean;
  onCancel: () => void;
  onRefund: () => void;
  isCancelling: boolean;
  isRefunding: boolean;
}) {
  const statusKey = (reg.status as StatusKey) in STATUS_TONES ? (reg.status as StatusKey) : null;
  const statusLabel = statusKey ? t(`status.${statusKey}` as const) : reg.status;
  const tone: StatusPillTone = statusKey ? STATUS_TONES[statusKey] : "neutral";

  const gradient = getCoverGradient(reg.eventId).bg;

  return (
    <article className="overflow-hidden rounded-card border bg-card transition-shadow hover:shadow-md">
      <div className="grid gap-0 md:grid-cols-[220px_1fr_auto]">
        <div
          aria-hidden="true"
          className="teranga-cover relative min-h-[160px] md:min-h-[180px]"
          style={{ background: gradient }}
        >
          <span className="absolute bottom-3 left-3 font-mono-kicker text-[11px] font-medium uppercase tracking-[0.08em] text-white/90">
            {reg.ticketTypeName ?? ""}
          </span>
        </div>

        <div className="p-6">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-mono-kicker text-[11px] uppercase tracking-[0.08em] text-teranga-gold-dark">
              {formatDate(reg.createdAt, regional)}
            </span>
            <StatusPill tone={tone} label={statusLabel} />
          </div>
          <h3 className="font-serif-display text-[22px] font-semibold leading-[1.2] tracking-[-0.015em]">
            {reg.eventTitle ?? reg.eventId}
          </h3>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
            <span className="font-semibold text-foreground">
              {reg.ticketTypeName ?? reg.ticketTypeId}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-kicker tracking-[0.04em]">
              {reg.qrCodeValue?.slice(0, 18) ?? reg.id.slice(0, 12)}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {t("registeredOn")} {formatDate(reg.createdAt, regional)}
            </span>
          </p>
          {isWaitlisted && reg.waitlistPosition && (
            <p
              role="status"
              aria-label={t("waitlistPositionAria", { n: reg.waitlistPosition })}
              className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-teranga-gold-dark"
            >
              <ListOrdered className="h-4 w-4" aria-hidden="true" />
              {t("waitlistPosition", { n: reg.waitlistPosition })}
            </p>
          )}
        </div>

        <div className="flex flex-col justify-center gap-2 border-t p-5 md:border-l md:border-t-0">
          {reg.status === "confirmed" && reg.qrCodeValue && (
            <Link href={`/my-events/${reg.id}/badge`}>
              <Button className="w-full rounded-full bg-teranga-navy text-white hover:bg-teranga-navy/90 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light">
                <QrCode className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t("badge")}
              </Button>
            </Link>
          )}
          <Link href={`/events/${reg.eventSlug ?? reg.eventId}`}>
            <Button variant="outline" size="sm" className="w-full rounded-full">
              {t("details")}
            </Button>
          </Link>
          <Link href={`/events/${reg.eventSlug ?? reg.eventId}/schedule`}>
            <Button variant="ghost" size="sm" className="w-full rounded-full">
              <Calendar className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t("viewSchedule")}
            </Button>
          </Link>
          {showRefund && reg.paymentId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefund}
              disabled={isRefunding}
              className="w-full rounded-full text-teranga-clay hover:bg-teranga-clay/10 hover:text-teranga-clay"
            >
              <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t("refund")}
            </Button>
          )}
          {isWaitlisted && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={isCancelling}
              className="w-full rounded-full text-teranga-gold-dark hover:bg-teranga-gold-whisper hover:text-teranga-gold-dark"
            >
              <LogOut className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t("leaveWaitlist")}
            </Button>
          )}
          {canCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={isCancelling}
              className="w-full rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <XCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t("cancel")}
            </Button>
          )}
          {reg.status === "cancelled" && (
            <p className="text-center text-sm italic text-muted-foreground">{t("cancelled")}</p>
          )}
        </div>
      </div>
    </article>
  );
}
