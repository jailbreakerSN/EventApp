"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  Input,
  Spinner,
  formatCurrency,
  formatDate,
  getErrorMessage,
} from "@teranga/shared-ui";
import type { Event, TicketType, Registration, PaymentMethod } from "@teranga/shared-types";
import { getCoverGradient } from "@/lib/cover-gradient";

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
  const locale = useLocale();
  const regional = intlLocale(locale);
  const { eventId } = useParams<{ eventId: string }>();
  const router = useRouter();
  const [step, setStep] = useState<Step>("select");
  const [selectedTicket, setSelectedTicket] = useState<TicketType | null>(null);
  const [registration, setRegistration] = useState<Registration | null>(null);

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
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-muted-foreground">{t("notFound")}</p>
        <Link href="/events" className="mt-4 inline-block text-teranga-gold hover:underline">
          {t("backToEvents")}
        </Link>
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
      <div className="mx-auto max-w-[880px] px-6 pt-10 pb-20 lg:px-8">
        {/* Stepper — editorial numbered circles matching the prototype. */}
        <div className="mb-9 flex flex-wrap items-center gap-3">
          <button
            onClick={() => (step === "select" ? router.back() : setStep("select"))}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {step === "success" ? t("back") : t("backToEvent")}
          </button>
          <div className="mx-auto flex items-center gap-2.5">
            {([1, 2, 3] as const).map((n, i) => {
              const done = currentStepNum > n;
              const active = currentStepNum === n;
              const label =
                n === 1
                  ? tStepper("step1")
                  : n === 2
                    ? tStepper("step2")
                    : tStepper("step3");
              return (
                <div key={n} className="flex items-center gap-2.5">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                      done
                        ? "bg-teranga-green text-white"
                        : active
                          ? "bg-teranga-navy text-white ring-[3px] ring-teranga-navy/20"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : n}
                  </span>
                  <span
                    className={`hidden text-sm sm:block ${
                      active
                        ? "font-semibold text-foreground"
                        : "font-medium text-muted-foreground"
                    }`}
                  >
                    {label}
                  </span>
                  {i < 2 && <span className="h-px w-8 bg-border" />}
                </div>
              );
            })}
          </div>
          <span className="font-mono-kicker text-[11px] tracking-[0.1em] text-muted-foreground">
            {tStepper("kicker", { step: currentStepNum, total: 3 })}
          </span>
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
                {isPaidTicket
                  ? tMethods("waveDescription").replace(/./, "")
                  : t("confirmHeading")}
              </p>

              {/* Payment method cards */}
              {isPaidTicket && discountedPrice > 0 && (
                <div
                  role="radiogroup"
                  aria-label={t("methodAria")}
                  className="mt-6 flex flex-col gap-2.5"
                >
                  {paymentMethods.map((method) => {
                    const isSelected = selectedMethod === method.id;
                    return (
                      <button
                        key={method.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => setSelectedMethod(method.id)}
                        className={`flex items-center gap-4 rounded-card border p-4 text-left transition-all ${
                          isSelected
                            ? "border-2 border-teranga-navy bg-muted/40"
                            : "border hover:border-foreground/30"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[10px] text-sm font-bold text-white"
                          style={{ backgroundColor: method.accent }}
                        >
                          {method.glyph}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold">{method.label}</span>
                          <span className="block text-xs text-muted-foreground">
                            {method.description}
                          </span>
                        </span>
                        <span
                          aria-hidden="true"
                          className={`h-5 w-5 flex-shrink-0 rounded-full transition-all ${
                            isSelected
                              ? "border-[6px] border-teranga-navy"
                              : "border-2 border-border"
                          }`}
                        />
                      </button>
                    );
                  })}
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
              <div className="overflow-hidden rounded-tile border bg-card">
                {/* Event cover thumb */}
                <div
                  aria-hidden="true"
                  className="teranga-cover relative h-[120px] w-full"
                  style={{
                    background: event.coverImageURL
                      ? `url(${event.coverImageURL}) center/cover`
                      : getCoverGradient(event.id).bg,
                  }}
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 to-transparent"
                  />
                  <div className="absolute bottom-3.5 left-4 right-4 text-white">
                    <p className="font-mono-kicker text-[10px] font-medium uppercase tracking-[0.12em] opacity-85">
                      {formatDate(event.startDate, regional)}
                    </p>
                    <p className="font-serif-display mt-1 line-clamp-2 text-[18px] font-semibold leading-[1.15]">
                      {event.title}
                    </p>
                  </div>
                </div>

                <div className="p-5">
                  <p className="font-mono-kicker mb-3 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {tSummary("kicker")}
                  </p>
                  <SummaryRow
                    label={selectedTicket.name}
                    value={
                      selectedTicket.price === 0
                        ? tCommon("free")
                        : formatCurrency(selectedTicket.price, selectedTicket.currency, regional)
                    }
                  />
                  {hasDiscount && discountAmount > 0 && (
                    <SummaryRow
                      label={tSummary("discount")}
                      value={`−${formatCurrency(discountAmount, selectedTicket.currency, regional)}`}
                      tone="discount"
                    />
                  )}
                  <SummaryRow
                    label={tSummary("serviceFees")}
                    value={tSummary("included")}
                    tone="muted"
                  />
                  <div className="my-3.5 h-px bg-border" />
                  <SummaryRow
                    label={tSummary("total")}
                    value={
                      discountedPrice === 0
                        ? tCommon("free")
                        : formatCurrency(discountedPrice, selectedTicket.currency, regional)
                    }
                    tone="total"
                  />
                  <p className="mt-3.5 text-[11px] leading-relaxed text-muted-foreground">
                    {tSummary("refundNote")}
                  </p>
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* Step 3: Success — editorial navy ticket reveal */}
        {step === "success" && registration && (
          <div className="mx-auto max-w-[560px] text-center">
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
            <div className="mx-auto mt-8 max-w-[440px] overflow-hidden rounded-pass bg-teranga-navy text-white shadow-[0_30px_60px_-25px_rgba(15,15,28,0.45)] animate-[slideUp_.6s_cubic-bezier(.2,.7,.2,1)_both]">
              <div
                className="relative px-7 pb-5 pt-6"
                style={{
                  background:
                    "linear-gradient(135deg, var(--tw-gradient-from), var(--tw-gradient-to))",
                  // @ts-expect-error — CSS custom properties
                  "--tw-gradient-from": "#1A1A2E",
                  "--tw-gradient-to": "#16213E",
                }}
              >
                <p className="font-mono-kicker text-[10px] font-medium uppercase tracking-[0.18em] text-teranga-gold-light">
                  {tSuccess("passLabel")}
                </p>
                <p className="font-serif-display mt-3.5 text-[24px] font-semibold leading-[1.1] tracking-[-0.018em]">
                  {event.title}
                </p>
                <div className="mt-5 flex gap-6 text-left">
                  <TicketField
                    label={tSuccess("dateLabel")}
                    value={formatDate(event.startDate, regional)}
                  />
                  <TicketField label={tSuccess("passTypeLabel")} value={selectedTicket!.name} />
                  <TicketField label={tSuccess("placeLabel")} value={event.location.city} />
                </div>
                <span
                  aria-hidden="true"
                  className="absolute -bottom-2.5 -left-2.5 h-5 w-5 rounded-full bg-background"
                />
                <span
                  aria-hidden="true"
                  className="absolute -bottom-2.5 -right-2.5 h-5 w-5 rounded-full bg-background"
                />
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-0 right-0 border-b border-dashed border-white/25"
                />
              </div>
              <div className="flex items-center gap-4 p-6">
                {registration.qrCodeValue && (
                  <span className="rounded-[10px] bg-white p-2">
                    <QRCodeSVG
                      value={registration.qrCodeValue}
                      size={104}
                      level="M"
                      includeMargin={false}
                    />
                  </span>
                )}
                <div className="min-w-0 flex-1 text-left">
                  <p className="font-mono-kicker text-[9px] font-medium uppercase tracking-[0.12em] text-white/60">
                    {tSuccess("codeLabel")}
                  </p>
                  <p className="font-mono-kicker mt-1 truncate text-[13px] font-semibold tracking-[0.04em]">
                    {registration.qrCodeValue ?? registration.id}
                  </p>
                  <span className="mt-3.5 inline-flex items-center rounded-full bg-teranga-gold px-2 py-0.5 text-[10px] font-bold tracking-[0.04em] text-teranga-navy">
                    {tSuccess("accessValid")}
                  </span>
                </div>
              </div>
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
              @keyframes slideUp {
                from {
                  opacity: 0;
                  transform: translateY(16px) scale(0.98);
                }
                to {
                  opacity: 1;
                  transform: translateY(0) scale(1);
                }
              }
            `}</style>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "muted" | "discount" | "total";
}) {
  const toneClasses =
    tone === "muted"
      ? "text-muted-foreground"
      : tone === "discount"
        ? "text-teranga-green"
        : tone === "total"
          ? "text-foreground font-bold text-[16px]"
          : "text-foreground";
  return (
    <div
      className={`flex items-center justify-between py-1.5 text-sm font-medium tabular-nums ${toneClasses}`}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function TicketField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono-kicker text-[9px] font-medium uppercase tracking-[0.12em] text-white/55">
        {label}
      </p>
      <p className="mt-1 text-[13px] font-semibold">{value}</p>
    </div>
  );
}
