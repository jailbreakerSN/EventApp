"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { parseAsStringEnum, useQueryStates } from "nuqs";
import { useTableState } from "@/hooks/use-table-state";
import Link from "next/link";
import {
  ArrowRight,
  Calendar,
  CalendarDays,
  Check,
  ExternalLink,
  Hourglass,
  LayoutList,
  ListOrdered,
  LogOut,
  QrCode,
  RotateCcw,
  Settings,
  XCircle,
} from "lucide-react";
import {
  EventCalendar,
  type CalendarEvent,
  type CalendarEventAction,
} from "@/components/event-calendar";
import { toast } from "sonner";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import {
  useMyRegistrations,
  useCancelRegistration,
  useCancelPendingRegistration,
} from "@/hooks/use-registrations";
import { useResumePayment } from "@/hooks/use-payments";
import { useAuth } from "@/hooks/use-auth";
import { eventsApi, paymentsApi } from "@/lib/api-client";
import {
  Button,
  Card,
  ConfirmDialog,
  EditorialHero,
  EmptyState,
  EmptyStateEditorial,
  formatDate,
  InlineErrorBanner,
  StatusPill,
  type StatusPillTone,
} from "@teranga/shared-ui";
import { useErrorHandler, type ResolvedError } from "@/hooks/use-error-handler";
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
type ViewMode = "list" | "calendar";

export default function MyEventsPage() {
  const t = useTranslations("myEvents");
  const locale = useLocale();
  const regional = intlLocale(locale);
  const { user } = useAuth();

  // W5 migration — useTableState owns the page index. Tab + viewMode are
  // UI discriminators (which view to render) not result filters; they
  // live in their own useQueryStates slot so they don't inflate
  // activeFilterCount and the URL stays human-readable
  // (?tab=past&view=calendar). The page index resets to 1 whenever tab
  // or viewMode changes — out-of-bounds protection when the underlying
  // dataset shape shifts.
  const ts = useTableState({
    urlNamespace: "regs",
    defaults: { sort: null, pageSize: 25 },
    sortableFields: [],
    filterParsers: {},
  });
  const [{ tab, view: viewMode }, setViewState] = useQueryStates(
    {
      tab: parseAsStringEnum<TabId>(["upcoming", "past", "saved"]).withDefault("upcoming"),
      view: parseAsStringEnum<ViewMode>(["list", "calendar"]).withDefault("list"),
    },
    { history: "replace", shallow: true },
  );
  const setTab = (next: TabId): void => {
    void setViewState({ tab: next === "upcoming" ? null : next });
  };
  const setViewMode = (next: ViewMode): void => {
    void setViewState({ view: next === "list" ? null : next });
  };
  // Page reset on tab / viewMode change — tabs surface different data
  // subsets, page N of "upcoming" doesn't map to anything in "past".
  // We track the previous tab/view in a ref so the effect only fires on
  // genuine axis transitions; including ts.page in the deps would
  // create a feedback loop (set page=1 → page changes → effect fires →
  // tries to set page=1 again).
  const prevAxisRef = React.useRef<{ tab: TabId; view: ViewMode }>({ tab, view: viewMode });
  useEffect(() => {
    if (prevAxisRef.current.tab !== tab || prevAxisRef.current.view !== viewMode) {
      prevAxisRef.current = { tab, view: viewMode };
      if (ts.page !== 1) ts.setPage(1);
    }
  }, [tab, viewMode, ts]);

  const { data, isLoading, error } = useMyRegistrations({ page: ts.page, limit: 20 });
  const cancelMutation = useCancelRegistration();
  const cancelPendingMutation = useCancelPendingRegistration();
  const resumePaymentMutation = useResumePayment();
  const queryClient = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [abandonTarget, setAbandonTarget] = useState<string | null>(null);
  const [refundTarget, setRefundTarget] = useState<{
    registrationId: string;
    paymentId: string;
  } | null>(null);
  // Persistent surface for blocking-mutation failures (cancel / refund). A
  // failed cancellation stays visible until the user dismisses it or retries,
  // replacing the transient toast.error pattern per
  // docs/design-system/error-handling.md.
  const [mutationError, setMutationError] = useState<ResolvedError | null>(null);
  const { resolve: resolveError } = useErrorHandler();
  const tErrors = useTranslations("errors");
  const tErrorActions = useTranslations("errors.actions");

  const registrations = data?.data;
  const meta = data?.meta;

  // Batch-fetch event details for every registration. The registration's
  // denormalized `eventStartDate` / `eventEndDate` are a snapshot taken at
  // registration time — if the organizer later reschedules the event, the
  // snapshot drifts. React Query caches per eventSlug/eventId, so this is
  // a single fetch per unique event (cheap on re-renders).
  const eventDetailQueries = useQueries({
    queries: (registrations ?? []).map((r) => ({
      queryKey: ["event-detail", r.eventSlug ?? r.eventId] as const,
      queryFn: () =>
        r.eventSlug
          ? eventsApi.getBySlug(r.eventSlug).then((res) => res.data)
          : eventsApi.getById(r.eventId).then((res) => res.data),
      staleTime: 5 * 60 * 1000,
      retry: 1,
    })),
  });

  // Map eventId → fetched event details so we can prefer fresh dates over
  // the (possibly stale) denormalized snapshot on the registration.
  const eventDetailMap = useMemo(() => {
    const map = new Map<string, { startDate?: string; endDate?: string; location?: string }>();
    (registrations ?? []).forEach((reg, i) => {
      const result = eventDetailQueries[i];
      if (result?.data) {
        const loc = result.data.location;
        map.set(reg.eventId, {
          startDate: result.data.startDate,
          endDate: result.data.endDate,
          // Event.location is a structured object; extract a display string.
          location:
            typeof loc === "string"
              ? loc
              : ((loc as { name?: string; city?: string } | undefined)?.name ??
                (loc as { name?: string; city?: string } | undefined)?.city),
        });
      }
    });
    return map;
  }, [registrations, eventDetailQueries]);

  const refundMutation = useMutation({
    mutationFn: (paymentId: string) => paymentsApi.refund(paymentId, t("refundReason")),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-registrations"] });
      setMutationError(null);
      toast.success(t("refundRequested"));
    },
    onError: (err: unknown) => {
      setMutationError(resolveError(err));
    },
  });

  const handleCancel = async () => {
    if (!cancelTarget) return;
    try {
      await cancelMutation.mutateAsync(cancelTarget);
      setMutationError(null);
      toast.success(t("cancelledSuccess"));
    } catch (err: unknown) {
      setMutationError(resolveError(err));
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

  const handleAbandonPending = async () => {
    if (!abandonTarget) return;
    try {
      await cancelPendingMutation.mutateAsync(abandonTarget);
      setMutationError(null);
      toast.success(t("abandonedSuccess"));
    } catch (err: unknown) {
      setMutationError(resolveError(err));
    } finally {
      setAbandonTarget(null);
    }
  };

  const handleResumePayment = async (paymentId: string | undefined) => {
    if (!paymentId) {
      setMutationError(resolveError(new Error(t("errors.paymentIdMissing"))));
      return;
    }
    try {
      const res = await resumePaymentMutation.mutateAsync(paymentId);
      const redirectUrl = (res as { data?: { redirectUrl?: string } })?.data?.redirectUrl;
      if (redirectUrl) {
        window.location.href = redirectUrl;
      } else {
        setMutationError(resolveError(new Error(t("errors.noRedirectUrl"))));
      }
    } catch (err: unknown) {
      setMutationError(resolveError(err));
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

  // Build CalendarEvent[] from upcoming registrations, backfilling startDate
  // from the fetched event details when the registration itself lacks it.
  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const result: CalendarEvent[] = [];
    for (const rawReg of upcoming) {
      const reg = rawReg as RegistrationWithExtras;
      const fetched = eventDetailMap.get(reg.eventId);
      // Prefer the live event date over the denormalized snapshot so a
      // rescheduled event surfaces on the right day in the calendar.
      const startDate = fetched?.startDate ?? reg.eventStartDate;
      if (!startDate) continue;
      result.push({
        id: reg.id,
        title: reg.eventTitle ?? reg.eventId,
        startDate,
        endDate: fetched?.endDate ?? reg.eventEndDate,
        status: reg.status,
        location: fetched?.location,
        slug: reg.eventSlug ?? undefined,
        gradient: getCoverGradient(reg.eventId).bg,
        variant: "mine",
      });
    }
    return result;
  }, [upcoming, eventDetailMap]);

  async function handleDiscovery(year: number, month: number): Promise<CalendarEvent[]> {
    const start = new Date(year, month, 1).toISOString();
    const end = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
    try {
      const res = await eventsApi.search({ dateFrom: start, dateTo: end, limit: 50 });
      return (res.data ?? []).map((ev) => {
        const loc = ev.location;
        const locationStr =
          typeof loc === "string"
            ? loc
            : ((loc as { name?: string; city?: string } | undefined)?.name ??
              (loc as { name?: string; city?: string } | undefined)?.city);
        return {
          id: `discovery-${ev.id}`,
          title: ev.title,
          startDate: ev.startDate,
          endDate: ev.endDate,
          location: locationStr,
          slug: ev.slug,
          gradient: getCoverGradient(ev.id).bg,
          variant: "discovery" as const,
        };
      });
    } catch {
      return [];
    }
  }

  const calendarLabels = {
    prevMonth: t("calendar.prevMonth"),
    nextMonth: t("calendar.nextMonth"),
    today: t("calendar.today"),
    more: t("calendar.more"),
    legend: t("calendar.legend"),
    legendConfirmed: t("calendar.confirmed"),
    legendCheckedIn: t("calendar.checkedIn"),
    legendPending: t("calendar.pending"),
    legendWaitlisted: t("calendar.waitlisted"),
    legendDiscovery: t("calendar.discoveryLegend"),
    discoveryOn: t("calendar.discoveryOn"),
    discoveryOff: t("calendar.discoveryOff"),
    closeDialog: t("calendar.closeDialog"),
  };

  function getCalendarActions(event: CalendarEvent): CalendarEventAction[] {
    if (event.variant === "discovery") {
      return [
        {
          label: t("details"),
          icon: <ExternalLink className="h-4 w-4" />,
          href: `/events/${event.slug ?? event.id.replace("discovery-", "")}`,
          variant: "primary",
        },
      ];
    }
    const reg = upcoming.find((r) => r.id === event.id) as RegistrationWithExtras | undefined;

    const acts: CalendarEventAction[] = [];
    if (event.slug) {
      acts.push({
        label: t("details"),
        icon: <ExternalLink className="h-4 w-4" />,
        href: `/events/${event.slug}`,
        variant: "primary",
      });
    }
    if (event.slug) {
      acts.push({
        label: t("viewSchedule"),
        icon: <Calendar className="h-4 w-4" />,
        href: `/events/${event.slug}/schedule`,
        variant: "outline",
      });
    }
    if (reg && (reg.status === "confirmed" || reg.status === "checked_in") && reg.qrCodeValue) {
      acts.push({
        label: t("badge"),
        icon: <QrCode className="h-4 w-4" />,
        href: `/my-events/${reg.id}/badge`,
        variant: "outline",
      });
    }
    if (reg?.status === "pending_payment") {
      acts.push({
        label: t("resumePayment"),
        icon: <Hourglass className="h-4 w-4" />,
        onClick: () => handleResumePayment(reg.paymentId),
        variant: "primary",
      });
      acts.push({
        label: t("abandonPayment"),
        icon: <XCircle className="h-4 w-4" />,
        onClick: () => setAbandonTarget(reg.id),
        variant: "danger",
      });
    }
    if (reg && ["confirmed", "pending"].includes(reg.status)) {
      acts.push({
        label: t("cancel"),
        icon: <XCircle className="h-4 w-4" />,
        onClick: () => setCancelTarget(reg.id),
        variant: "danger",
      });
    }
    return acts;
  }

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

      {/* Persistent mutation-error banner — renders when a cancel or refund
          attempt fails. Replaces the 4-second toast that vanished before
          the participant had time to read why it failed. See
          docs/design-system/error-handling.md. */}
      {mutationError && (
        <InlineErrorBanner
          className="mb-7"
          severity={mutationError.severity}
          kicker={tErrors("kicker")}
          title={mutationError.title}
          description={mutationError.description}
          actions={[{ label: tErrorActions("dismiss"), onClick: () => setMutationError(null) }]}
          onDismiss={() => setMutationError(null)}
          dismissLabel={tErrorActions("dismiss")}
        />
      )}

      {/* Tab bar + view toggle */}
      <div className="mb-8 flex items-end justify-between border-b">
        <div role="tablist" aria-label={t("title")} className="flex gap-1">
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

        {/* List / Calendar view toggle — only relevant on the upcoming tab */}
        {tab === "upcoming" && (
          <div
            role="group"
            aria-label={t("viewToggleAria")}
            className="mb-1 flex items-center gap-0.5 rounded-full border bg-muted/40 p-0.5"
          >
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                viewMode === "list"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              aria-pressed={viewMode === "list"}
            >
              <LayoutList className="h-3.5 w-3.5" aria-hidden="true" />
              {t("viewList")}
            </button>
            <button
              onClick={() => setViewMode("calendar")}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                viewMode === "calendar"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              aria-pressed={viewMode === "calendar"}
            >
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              {t("viewCalendar")}
            </button>
          </div>
        )}
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
        <div role="tabpanel" id="panel-upcoming">
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

          {/* Calendar view */}
          {viewMode === "calendar" && registrations && (
            <EventCalendar
              events={calendarEvents}
              loading={isLoading}
              labels={calendarLabels}
              onDiscovery={handleDiscovery}
              actions={getCalendarActions}
            />
          )}

          {/* List view */}
          {viewMode === "list" && (
            <div className="flex flex-col gap-4">
              {upcoming.map((rawReg) => {
                const reg = rawReg as RegistrationWithExtras;
                const fetched = eventDetailMap.get(reg.eventId);
                const eventStartDate = fetched?.startDate ?? reg.eventStartDate;
                return (
                  <UpcomingRow
                    key={reg.id}
                    reg={reg}
                    eventStartDate={eventStartDate}
                    regional={regional}
                    t={t}
                    canCancel={["confirmed", "pending"].includes(reg.status)}
                    isWaitlisted={reg.status === "waitlisted"}
                    isPendingPayment={reg.status === "pending_payment"}
                    showRefund={canRequestRefund(reg)}
                    onCancel={() => setCancelTarget(reg.id)}
                    onAbandon={() => setAbandonTarget(reg.id)}
                    onResume={() => handleResumePayment(reg.paymentId)}
                    onRefund={() => {
                      if (reg.paymentId) {
                        setRefundTarget({ registrationId: reg.id, paymentId: reg.paymentId });
                      }
                    }}
                    isCancelling={cancelMutation.isPending}
                    isAbandoning={cancelPendingMutation.isPending}
                    isResuming={resumePaymentMutation.isPending}
                    isRefunding={refundMutation.isPending}
                  />
                );
              })}
            </div>
          )}
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
                const statusTone: StatusPillTone = statusKey ? STATUS_TONES[statusKey] : "neutral";
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
      {meta && meta.totalPages > 1 && tab === "upcoming" ? (
        <nav
          aria-label="Pagination de mes événements"
          className="mt-8 flex items-center justify-center gap-2"
        >
          <Button
            variant="outline"
            size="sm"
            disabled={ts.page <= 1}
            onClick={() => ts.setPage(Math.max(1, ts.page - 1))}
            className="rounded-full"
          >
            {t("paginationPrev")}
          </Button>
          <span
            className="flex items-center text-sm text-muted-foreground"
            aria-current="page"
          >
            {t("paginationOf", { page: ts.page, total: meta.totalPages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={ts.page >= meta.totalPages}
            onClick={() => ts.setPage(ts.page + 1)}
            className="rounded-full"
          >
            {t("paginationNext")}
          </Button>
        </nav>
      ) : null}

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

      <ConfirmDialog
        open={abandonTarget !== null}
        onConfirm={handleAbandonPending}
        onCancel={() => setAbandonTarget(null)}
        title={t("abandonDialog.title")}
        description={t("abandonDialog.description")}
        confirmLabel={t("abandonDialog.confirm")}
        cancelLabel={t("abandonDialog.cancel")}
        variant="danger"
      />
    </div>
  );
}

// Editorial upcoming row — 220px cover column + main content + action column.
// Cover gradient rotates per event.id via getCoverGradient.
function UpcomingRow({
  reg,
  eventStartDate,
  regional,
  t,
  canCancel,
  isWaitlisted,
  isPendingPayment,
  showRefund,
  onCancel,
  onAbandon,
  onResume,
  onRefund,
  isCancelling,
  isAbandoning,
  isResuming,
  isRefunding,
}: {
  reg: Registration & { paymentId?: string; waitlistPosition?: number };
  eventStartDate: string | undefined;
  regional: string;
  t: ReturnType<typeof useTranslations<"myEvents">>;
  canCancel: boolean;
  isWaitlisted: boolean;
  isPendingPayment: boolean;
  showRefund: boolean;
  onCancel: () => void;
  onAbandon: () => void;
  onResume: () => void;
  onRefund: () => void;
  isCancelling: boolean;
  isAbandoning: boolean;
  isResuming: boolean;
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
              {formatDate(eventStartDate ?? reg.createdAt, regional)}
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
            <span className="font-mono-kicker uppercase tracking-[0.08em]" title={reg.id}>
              {t("refShort", { ref: reg.id.slice(-8).toUpperCase() })}
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
          {/* Badge is the primary action — visible only when the registration
              is in a state where the QR is meaningful (confirmed → entry
              ticket, checked_in → proof of attendance). NEVER for
              pending_payment, pending, waitlisted, cancelled, refunded. */}
          {(reg.status === "confirmed" || reg.status === "checked_in") && reg.qrCodeValue && (
            <Link href={`/my-events/${reg.id}/badge`}>
              <Button className="w-full rounded-full bg-teranga-navy text-white hover:bg-teranga-navy/90 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light">
                <QrCode className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t("badge")}
              </Button>
            </Link>
          )}
          {/* pending_payment — primary action is RESUME PAYMENT. Secondary
              action is ABANDON, which atomically expires the placeholder
              registration + payment so the user can re-register cleanly. */}
          {isPendingPayment && (
            <>
              <Button
                onClick={onResume}
                disabled={isResuming}
                className="w-full rounded-full bg-teranga-gold text-teranga-navy hover:bg-teranga-gold-light"
              >
                <Hourglass className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t("resumePayment")}
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">
                {t("pendingPaymentNotice")}
              </p>
            </>
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
              className="w-full rounded-full text-teranga-clay-dark hover:bg-teranga-clay/10 hover:text-teranga-clay-dark"
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
          {isPendingPayment && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onAbandon}
              disabled={isAbandoning}
              className="w-full rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <XCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t("abandonPayment")}
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
