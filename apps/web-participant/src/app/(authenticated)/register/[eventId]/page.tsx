"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CreditCard,
  Loader2,
  Tag,
  ChevronDown,
  ChevronUp,
  X,
  Check,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { eventsApi, registrationsApi } from "@/lib/api-client";
import { useRegister } from "@/hooks/use-registrations";
import { useInitiatePayment, useValidatePromoCode } from "@/hooks/use-payments";
import {
  Button,
  EmptyStateEditorial,
  Input,
  Spinner,
  Stepper,
  OrderSummary,
  TicketPass,
  PaymentMethodCard,
  formatCurrency,
  formatDate,
  getErrorMessage,
} from "@teranga/shared-ui";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Event, TicketType, Registration, PaymentMethod } from "@teranga/shared-types";
import { intlLocale } from "@/lib/intl-locale";
import { saveBadge } from "@/lib/badge-store";
import { useAuth } from "@/hooks/use-auth";

type Step = "select" | "confirm" | "success";
type StepNum = 1 | 2 | 3;

const STEP_TO_NUM: Record<Step, StepNum> = { select: 1, confirm: 2, success: 3 };

type StatusKey = "confirmed" | "pending" | "pending_payment" | "waitlisted" | "checked_in";

export default function RegisterPage() {
  const t = useTranslations("registerFlow");
  const tMethods = useTranslations("registerFlow.methods");
  const tStepper = useTranslations("registerFlow.stepper");
  const tSummary = useTranslations("registerFlow.summary");
  const tSuccess = useTranslations("registerFlow.success");
  const tStatus = useTranslations("registerFlow.statusLabels");
  const tCommon = useTranslations("common");
  const tBadge = useTranslations("badge");
  const locale = useLocale();
  const regional = intlLocale(locale);
  const { user, resendVerification } = useAuth();
  const [resendingVerification, setResendingVerification] = useState(false);

  const handleResendVerification = async () => {
    if (resendingVerification) return;
    setResendingVerification(true);
    try {
      await resendVerification();
      toast.success(t("verificationResent"));
    } catch {
      toast.error(t("verificationResendError"));
    } finally {
      setResendingVerification(false);
    }
  };
  const { eventId } = useParams<{ eventId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const ticketParam = searchParams.get("ticket");
  const [step, setStep] = useState<Step>("select");
  const [selectedTicket, setSelectedTicket] = useState<TicketType | null>(null);
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [emailNotVerified, setEmailNotVerified] = useState(false);

  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>("wave");

  const paymentMethods = useMemo(
    () =>
      [
        {
          id: "wave" as PaymentMethod,
          label: tMethods("wave"),
          description: tMethods("waveDescription"),
          glyph: "W",
          accent: "#1DC8F1",
        },
        {
          id: "orange_money" as PaymentMethod,
          label: tMethods("orange_money"),
          description: tMethods("orangeMoneyDescription"),
          glyph: "OM",
          accent: "#FF7900",
        },
        {
          id: "free_money" as PaymentMethod,
          label: tMethods("free_money"),
          description: tMethods("freeMoneyDescription"),
          glyph: "F",
          accent: "#CD0067",
        },
        {
          id: "card" as PaymentMethod,
          label: tMethods("card"),
          description: tMethods("cardDescription"),
          glyph: "CB",
          accent: "#635bff",
        },
      ] as const,
    [tMethods],
  );

  const [promoOpen, setPromoOpen] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [promoResult, setPromoResult] = useState<{
    promoCodeId: string;
    discountType: "percentage" | "fixed";
    discountValue: number;
    code: string;
  } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const validatePromo = useValidatePromoCode();

  const { data: eventData, isLoading: eventLoading } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => eventsApi.getById(eventId),
    staleTime: 5 * 60_000,
  });

  const { data: myRegsData, isLoading: regsLoading } = useQuery({
    queryKey: ["my-registrations-check", eventId],
    queryFn: () => registrationsApi.getMyRegistrations({ limit: 100 }),
    staleTime: 60_000,
  });

  const registerMutation = useRegister();
  const paymentMutation = useInitiatePayment();

  const event = (eventData as { data?: Event })?.data as Event | undefined;
  const myRegs = (myRegsData as { data?: Registration[] })?.data as Registration[] | undefined;
  const existingRegistration = myRegs?.find(
    (r) => r.eventId === eventId && r.status !== "cancelled",
  );

  const isPaidTicket = selectedTicket && selectedTicket.price > 0;
  const isSubmitting = registerMutation.isPending || paymentMutation.isPending;

  // Pre-select a ticket when the user arrives via a deep link from the event
  // detail sidebar (e.g. /register/:eventId?ticket=:ticketTypeId). We only
  // apply it once on initial mount while the user is still on Step 1, and
  // only if the ticket is visible and not sold out — otherwise we fall back
  // to the existing default behaviour.
  useEffect(() => {
    if (!event || !ticketParam || selectedTicket || step !== "select") return;
    const match = event.ticketTypes.find((t) => t.id === ticketParam);
    if (!match || !match.isVisible) return;
    const remaining = match.totalQuantity ? match.totalQuantity - match.soldCount : null;
    const soldOut = remaining !== null && remaining <= 0;
    if (soldOut) return;
    setSelectedTicket(match);
  }, [event, ticketParam, selectedTicket, step]);

  // Persist the freshly-minted badge to IndexedDB as soon as we reach
  // the success step so day-of check-in works even if the participant
  // drops connectivity before re-opening the app.
  useEffect(() => {
    if (step !== "success" || !registration?.qrCodeValue || !event) return;
    saveBadge({
      registrationId: registration.id,
      qrCodeValue: registration.qrCodeValue,
      eventId: event.id,
      eventTitle: event.title,
      holderName: registration.participantName ?? user?.displayName ?? user?.email ?? "",
      ticketTypeName: selectedTicket?.name ?? registration.ticketTypeName ?? "",
      cachedAt: new Date().toISOString(),
    });
  }, [step, registration, event, selectedTicket, user?.displayName, user?.email]);

  const getDiscountedPrice = (originalPrice: number) => {
    if (!promoResult || originalPrice === 0) return originalPrice;
    if (promoResult.discountType === "percentage") {
      return Math.max(0, Math.round(originalPrice * (1 - promoResult.discountValue / 100)));
    }
    return Math.max(0, originalPrice - promoResult.discountValue);
  };

  const discountedPrice = selectedTicket ? getDiscountedPrice(selectedTicket.price) : 0;
  const hasDiscount = promoResult && selectedTicket && discountedPrice < selectedTicket.price;
  const discountAmount = selectedTicket ? selectedTicket.price - discountedPrice : 0;

  const handleApplyPromo = async () => {
    if (!promoInput.trim() || !selectedTicket) return;
    setPromoError(null);
    try {
      const result = await validatePromo.mutateAsync({
        eventId,
        code: promoInput.trim(),
        ticketTypeId: selectedTicket.id,
      });
      const data = (
        result as {
          data?: {
            promoCodeId: string;
            discountType: "percentage" | "fixed";
            discountValue: number;
          };
        }
      )?.data;
      if (data) {
        setPromoResult({ ...data, code: promoInput.trim().toUpperCase() });
        toast.success(t("promoApplied"));
      }
    } catch (err: unknown) {
      const message = (err as { message?: string })?.message;
      setPromoError(message ?? t("promoInvalid"));
      setPromoResult(null);
    }
  };

  const handleRemovePromo = () => {
    setPromoResult(null);
    setPromoInput("");
    setPromoError(null);
  };

  const handleConfirm = async () => {
    if (!selectedTicket) return;

    if (isPaidTicket) {
      if (discountedPrice === 0) {
        try {
          const result = await registerMutation.mutateAsync({
            eventId,
            ticketTypeId: selectedTicket.id,
          });
          setRegistration((result as { data?: Registration })?.data as Registration);
          setStep("success");
          toast.success(t("successSubmit"));
          return;
        } catch (err: unknown) {
          const code = (err as { code?: string })?.code;
          const message = (err as { message?: string })?.message;
          if (code === "EMAIL_NOT_VERIFIED") setEmailNotVerified(true);
          toast.error(getErrorMessage(code, message));
          return;
        }
      }

      try {
        const result = await paymentMutation.mutateAsync({
          eventId,
          ticketTypeId: selectedTicket.id,
          method: selectedMethod,
        });
        const data = (result as { data?: { paymentId: string; redirectUrl: string } })?.data;
        if (data?.redirectUrl) {
          window.location.href = data.redirectUrl;
        }
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        const message = (err as { message?: string })?.message;
        if (code === "EMAIL_NOT_VERIFIED") setEmailNotVerified(true);
        toast.error(getErrorMessage(code, message));
      }
    } else {
      try {
        const result = await registerMutation.mutateAsync({
          eventId,
          ticketTypeId: selectedTicket.id,
        });
        setRegistration((result as { data?: Registration })?.data as Registration);
        setStep("success");
        toast.success(t("successSubmit"));
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        const message = (err as { message?: string })?.message;
        if (code === "EMAIL_NOT_VERIFIED") setEmailNotVerified(true);
        toast.error(getErrorMessage(code, message));
      }
    }
  };

  if (eventLoading || regsLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <EmptyStateEditorial
          icon={AlertTriangle}
          kicker="— INTROUVABLE"
          title={t("notFound")}
          action={
            <Link
              href="/events"
              className="text-sm font-medium text-teranga-gold-dark hover:underline"
            >
              {t("backToEvents")}
            </Link>
          }
        />
      </div>
    );
  }

  if (existingRegistration) {
    const statusKey = existingRegistration.status as StatusKey;
    const statusLabel = [
      "confirmed",
      "pending",
      "pending_payment",
      "waitlisted",
      "checked_in",
    ].includes(statusKey)
      ? tStatus(statusKey)
      : existingRegistration.status;

    return (
      <div className="mx-auto max-w-xl px-6 py-12 lg:px-8">
        <button
          onClick={() => router.back()}
          className="mb-6 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("backToEvent")}
        </button>
        <h1 className="font-serif-display text-3xl font-semibold tracking-[-0.02em]">
          {event.title}
        </h1>
        <div className="mt-8 rounded-tile border bg-card p-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teranga-green/10">
            <Check className="h-10 w-10 text-teranga-green" strokeWidth={2.5} />
          </div>
          <h2 className="font-serif-display mt-4 text-xl font-semibold">
            {t("alreadyRegistered")}
          </h2>
          <p className="mt-2 text-muted-foreground">{t("statusPrefix", { status: statusLabel })}</p>
          {existingRegistration.qrCodeValue && (
            <div className="mt-6 inline-block rounded-card bg-white p-4 shadow-md">
              <QRCodeSVG
                value={existingRegistration.qrCodeValue}
                size={180}
                level="M"
                includeMargin
              />
            </div>
          )}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link href={`/my-events/${existingRegistration.id}/badge`}>
              <Button variant="outline">{t("viewBadge")}</Button>
            </Link>
            <Link href="/my-events">
              <Button className="bg-teranga-navy text-white hover:bg-teranga-navy/90">
                {t("myRegistrations")}
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const visibleTickets = event.ticketTypes.filter((x) => x.isVisible);
  const currentStepNum = STEP_TO_NUM[step];

  return (
    <div className="bg-muted/20">
      <div className="mx-auto max-w-4xl px-6 pt-10 pb-20 lg:px-8">
        {/* Email-not-verified panel — fires when the API rejects a paid
            registration because the user hasn't clicked the verification
            link yet. Inline + actionable beats a toast-only failure. */}
        {emailNotVerified && (
          <div
            role="alert"
            className="mb-6 flex flex-wrap items-start gap-3 rounded-card border border-teranga-clay/30 bg-teranga-clay/5 p-4 dark:border-teranga-clay/40 dark:bg-teranga-clay/15"
          >
            <AlertTriangle
              className="mt-0.5 h-5 w-5 flex-shrink-0 text-teranga-clay"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-teranga-clay">{t("verifyEmailTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("verifyEmailBody", { email: user?.email ?? "" })}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleResendVerification}
                disabled={resendingVerification}
                className="mt-3"
              >
                {resendingVerification ? t("verificationResending") : t("resendVerification")}
              </Button>
            </div>
          </div>
        )}

        {/* Stepper — editorial numbered circles matching the prototype. */}
        <div className="mb-9 flex flex-wrap items-center gap-3">
          <button
            onClick={() => (step === "select" ? router.back() : setStep("select"))}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {step === "success" ? t("back") : t("backToEvent")}
          </button>
          <Stepper
            className="flex-1"
            steps={[
              { label: tStepper("step1") },
              { label: tStepper("step2") },
              { label: tStepper("step3") },
            ]}
            currentStep={currentStepNum}
            kickerFormatter={(step, total) => tStepper("kicker", { step, total })}
            ariaLabel={tStepper("step1")}
          />
        </div>

        {/* Step 1: Ticket selection */}
        {step === "select" && (
          <div>
            <h1 className="font-serif-display text-[28px] font-semibold tracking-[-0.02em]">
              {t("selectHeading")}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{event.title}</p>
            <div className="mt-6 flex flex-col gap-3">
              {visibleTickets.map((ticket) => {
                const remaining = ticket.totalQuantity
                  ? ticket.totalQuantity - ticket.soldCount
                  : null;
                const soldOut = remaining !== null && remaining <= 0;
                return (
                  <button
                    key={ticket.id}
                    disabled={soldOut}
                    onClick={() => {
                      setSelectedTicket(ticket);
                      setStep("confirm");
                    }}
                    className={`group rounded-card border p-5 text-left transition-all ${
                      soldOut
                        ? "cursor-not-allowed opacity-50"
                        : "bg-card hover:-translate-y-0.5 hover:border-teranga-navy/30 hover:shadow-md"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-semibold">{ticket.name}</p>
                        {ticket.description && (
                          <p className="mt-1 text-sm text-muted-foreground">{ticket.description}</p>
                        )}
                        {remaining !== null && !soldOut && remaining < 20 && (
                          <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-teranga-clay">
                            <span
                              aria-hidden="true"
                              className="inline-block h-1 w-1 rounded-full bg-teranga-clay"
                            />
                            {t("seatsLeft", { count: remaining })}
                          </p>
                        )}
                      </div>
                      <p className="shrink-0 text-[17px] font-bold tabular-nums">
                        {ticket.price === 0
                          ? tCommon("free")
                          : formatCurrency(ticket.price, ticket.currency, regional)}
                      </p>
                    </div>
                    {soldOut && (
                      <p className="mt-3 inline-flex items-center rounded-full bg-destructive/10 px-2.5 py-0.5 text-[11px] font-semibold text-destructive">
                        {t("soldOut")}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 2: Confirm + payment — two-column grid with sticky order summary */}
        {step === "confirm" && selectedTicket && (
          <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
            <div className="rounded-tile border bg-card p-7 lg:p-8">
              <h1 className="font-serif-display text-[28px] font-semibold tracking-[-0.02em]">
                {isPaidTicket ? t("chooseMethod") : t("confirmHeading")}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {isPaidTicket ? tMethods("waveDescription").replace(/./, "") : t("confirmHeading")}
              </p>

              {/* Payment method cards */}
              {isPaidTicket && discountedPrice > 0 && (
                <div
                  role="radiogroup"
                  aria-label={t("methodAria")}
                  className="mt-6 flex flex-col gap-2.5"
                >
                  {paymentMethods.map((method) => (
                    <PaymentMethodCard
                      key={method.id}
                      glyph={method.glyph}
                      accent={method.accent}
                      name={method.label}
                      description={method.description}
                      selected={selectedMethod === method.id}
                      onClick={() => setSelectedMethod(method.id)}
                    />
                  ))}
                </div>
              )}

              {/* Redirect notice */}
              {isPaidTicket && discountedPrice > 0 && (
                <div className="mt-5 flex items-start gap-3 rounded-card border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-950/30">
                  <CreditCard
                    className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400"
                    aria-hidden="true"
                  />
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    {t("redirectNotice", {
                      method:
                        paymentMethods.find((m) => m.id === selectedMethod)?.label ??
                        t("redirectNoticeFallback"),
                    })}
                  </p>
                </div>
              )}

              {/* Promo */}
              {selectedTicket.price > 0 && (
                <div className="mt-5 rounded-card border">
                  <button
                    type="button"
                    onClick={() => setPromoOpen(!promoOpen)}
                    className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    <span className="flex items-center gap-2">
                      <Tag className="h-4 w-4" aria-hidden="true" />
                      {t("promoHeading")}
                    </span>
                    {promoOpen ? (
                      <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                  {promoOpen && !promoResult && (
                    <div className="space-y-3 border-t px-4 py-3">
                      <div className="flex gap-2">
                        <Input
                          placeholder={t("promoPlaceholder")}
                          value={promoInput}
                          onChange={(e) => {
                            setPromoInput(e.target.value);
                            setPromoError(null);
                          }}
                          className="flex-1 uppercase tracking-[0.05em]"
                          disabled={validatePromo.isPending}
                        />
                        <Button
                          type="button"
                          onClick={handleApplyPromo}
                          disabled={!promoInput.trim() || validatePromo.isPending}
                          variant="outline"
                        >
                          {validatePromo.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            t("promoApply")
                          )}
                        </Button>
                      </div>
                      {promoError && <p className="text-xs text-destructive">{promoError}</p>}
                    </div>
                  )}
                  {promoResult && (
                    <div className="flex items-center justify-between border-t px-4 py-3 text-xs">
                      <span className="flex items-center gap-2 text-teranga-green">
                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        {promoResult.code} ·{" "}
                        {promoResult.discountType === "percentage"
                          ? `−${promoResult.discountValue}%`
                          : `−${formatCurrency(promoResult.discountValue, "XOF", regional)}`}
                      </span>
                      <button
                        type="button"
                        onClick={handleRemovePromo}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={tCommon("cancel")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {event.requiresApproval && !isPaidTicket && (
                <p className="mt-5 text-sm text-amber-600 dark:text-amber-400">
                  {t("approvalNotice")}
                </p>
              )}

              {/* Footer actions */}
              <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setStep("select");
                    handleRemovePromo();
                  }}
                  disabled={isSubmitting}
                >
                  {t("back")}
                </Button>
                <Button
                  className="inline-flex items-center gap-2 rounded-full bg-teranga-navy px-7 py-3 text-sm font-semibold text-white hover:bg-teranga-navy/90 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light"
                  onClick={handleConfirm}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      {isPaidTicket && (!hasDiscount || discountedPrice > 0)
                        ? t("redirecting")
                        : t("registering")}
                    </>
                  ) : (
                    <>
                      {hasDiscount
                        ? discountedPrice === 0
                          ? t("confirmFree")
                          : t("payAmount", {
                              amount: formatCurrency(
                                discountedPrice,
                                selectedTicket.currency,
                                regional,
                              ),
                            })
                        : isPaidTicket
                          ? t("payAmount", {
                              amount: formatCurrency(
                                selectedTicket.price,
                                selectedTicket.currency,
                                regional,
                              ),
                            })
                          : t("confirm")}
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Order summary sticky sidebar — editorial, matches prototype. */}
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <OrderSummary
                coverKey={event.id}
                coverImageURL={event.coverImageURL ?? null}
                eventStartDate={event.startDate}
                eventTitle={event.title}
                ticketName={selectedTicket.name}
                subtotal={selectedTicket.price}
                discount={hasDiscount ? discountAmount : 0}
                total={discountedPrice}
                currency={selectedTicket.currency}
                locale={regional}
                refundNote={tSummary("refundNote")}
                labels={{
                  kicker: tSummary("kicker"),
                  serviceFees: tSummary("serviceFees"),
                  serviceFeesValue: tSummary("included"),
                  discount: tSummary("discount"),
                  total: tSummary("total"),
                  free: tCommon("free"),
                }}
              />
            </aside>
          </div>
        )}

        {/* Step 3: Success — editorial navy ticket reveal */}
        {step === "success" && registration && (
          <div className="mx-auto max-w-xl text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teranga-green text-white animate-[pop_.4s_cubic-bezier(.2,.9,.2,1.2)_both]">
              <Check className="h-8 w-8" strokeWidth={3} aria-hidden="true" />
            </span>
            <p className="font-mono-kicker mt-5 text-[11px] font-medium uppercase tracking-[0.16em] text-teranga-gold-dark">
              {tSuccess("kicker")}
            </p>
            <h1 className="font-serif-display mt-3.5 text-[34px] font-semibold tracking-[-0.025em] text-balance sm:text-[40px]">
              {event.requiresApproval ? t("successPendingApproval") : tSuccess("headline")}
            </h1>
            <p className="mt-4 text-base text-muted-foreground">{tSuccess("body")}</p>

            {/* Ticket reveal */}
            <TicketPass
              className="mx-auto mt-8 max-w-md shadow-[0_30px_60px_-25px_rgba(15,15,28,0.45)]"
              coverKey={event.id}
              kicker={tSuccess("passLabel")}
              eventTitle={event.title}
              fields={[
                { label: tSuccess("dateLabel"), value: formatDate(event.startDate, regional) },
                { label: tSuccess("passTypeLabel"), value: selectedTicket!.name },
                { label: tSuccess("placeLabel"), value: event.location.city },
              ]}
              qr={
                registration.qrCodeValue ? (
                  <QRCodeSVG
                    value={registration.qrCodeValue}
                    size={104}
                    level="M"
                    includeMargin={false}
                  />
                ) : null
              }
              codeLabel={tSuccess("codeLabel")}
              codeValue={registration.qrCodeValue ?? registration.id}
              validAccessLabel={tSuccess("accessValid")}
              footerVariant="inline"
              animateReveal
            />

            {/* Offline-saved chip — makes the core differentiator visible
                the moment registration completes so the participant knows
                the badge works on day-of even without connectivity. */}
            {registration.qrCodeValue && (
              <div
                role="status"
                aria-live="polite"
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-teranga-green"
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>⚡ {tBadge("savedOfflineChip")}</span>
              </div>
            )}

            {/* Next-step cue — drives verified-email rate + offline-ready
                rate + programme engagement by making the next three
                actions explicit right at the moment of conversion. */}
            <div className="mx-auto mt-10 grid max-w-xl gap-3 text-left sm:grid-cols-3">
              {[
                {
                  num: "01",
                  label: tSuccess("nextStep.verifyEmail"),
                  description: tSuccess("nextStep.verifyEmailHint"),
                  href: "/settings",
                  done: user?.emailVerified ?? false,
                },
                {
                  num: "02",
                  label: tSuccess("nextStep.downloadBadge"),
                  description: tSuccess("nextStep.downloadBadgeHint"),
                  href: `/my-events/${registration.id}/badge`,
                  done: false,
                },
                {
                  num: "03",
                  label: tSuccess("nextStep.exploreSchedule"),
                  description: tSuccess("nextStep.exploreScheduleHint"),
                  href: `/events/${event.slug}/schedule`,
                  done: false,
                },
              ].map((step) => (
                <Link
                  key={step.num}
                  href={step.href}
                  className="group rounded-card border bg-card p-4 transition-colors hover:border-teranga-navy/30 hover:bg-muted/40 dark:hover:border-teranga-gold/40"
                >
                  <p className="font-mono-kicker text-[11px] font-medium uppercase tracking-[0.12em] text-teranga-gold-dark">
                    {step.done ? `✓ ${step.num}` : step.num}
                  </p>
                  <p className="mt-1.5 text-sm font-semibold text-foreground">{step.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
                </Link>
              ))}
            </div>

            {/* Actions */}
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href={`/my-events/${registration.id}/badge`}>
                <Button variant="outline" className="rounded-full">
                  {t("viewBadge")}
                </Button>
              </Link>
              <Link href="/my-events">
                <Button variant="outline" className="rounded-full">
                  {t("myRegistrations")}
                </Button>
              </Link>
              <Link href="/events">
                <Button className="rounded-full bg-teranga-navy text-white hover:bg-teranga-navy/90 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light">
                  {t("exploreOthers")}
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Button>
              </Link>
            </div>

            <style jsx>{`
              @keyframes pop {
                from {
                  transform: scale(0);
                }
                to {
                  transform: scale(1);
                }
              }
            `}</style>
          </div>
        )}
      </div>
    </div>
  );
}
