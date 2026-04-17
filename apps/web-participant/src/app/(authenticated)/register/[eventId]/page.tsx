"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle,
  ArrowLeft,
  Ticket,
  CalendarCheck,
  CreditCard,
  Loader2,
  Tag,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { eventsApi, registrationsApi } from "@/lib/api-client";
import { useRegister } from "@/hooks/use-registrations";
import { useInitiatePayment, useValidatePromoCode } from "@/hooks/use-payments";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Input,
  Spinner,
  Badge,
  formatCurrency,
  getErrorMessage,
} from "@teranga/shared-ui";
import type { Event, TicketType, Registration, PaymentMethod } from "@teranga/shared-types";

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

type StatusKey = "confirmed" | "pending" | "pending_payment" | "waitlisted" | "checked_in";

export default function RegisterPage() {
  const t = useTranslations("registerFlow");
  const tMethods = useTranslations("registerFlow.methods");
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
          accent: "#1DC8F1",
        },
        {
          id: "orange_money" as PaymentMethod,
          label: tMethods("orange_money"),
          description: tMethods("orangeMoneyDescription"),
          accent: "#FF7900",
        },
        {
          id: "free_money" as PaymentMethod,
          label: tMethods("free_money"),
          description: tMethods("freeMoneyDescription"),
          accent: "#CD0067",
        },
        {
          id: "card" as PaymentMethod,
          label: tMethods("card"),
          description: tMethods("cardDescription"),
          accent: "#1F2937",
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
    const statusLabel = ["confirmed", "pending", "pending_payment", "waitlisted", "checked_in"].includes(
      statusKey,
    )
      ? tStatus(statusKey)
      : existingRegistration.status;

    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <button
          onClick={() => router.back()}
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("backToEvent")}
        </button>

        <h1 className="text-2xl font-bold">{event.title}</h1>

        <Card className="mt-6">
          <CardContent className="flex flex-col items-center py-8">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teranga-green/10">
              <CalendarCheck className="h-10 w-10 text-teranga-green" />
            </div>
            <h2 className="mt-4 text-xl font-bold">{t("alreadyRegistered")}</h2>
            <p className="mt-2 text-center text-muted-foreground">
              {t("statusPrefix", { status: statusLabel })}
            </p>

            {existingRegistration.qrCodeValue && (
              <div className="mt-6 inline-block rounded-lg bg-white p-4 shadow-md">
                <QRCodeSVG
                  value={existingRegistration.qrCodeValue}
                  size={180}
                  level="M"
                  includeMargin
                />
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href={`/my-events/${existingRegistration.id}/badge`}>
                <Button variant="outline">{t("viewBadge")}</Button>
              </Link>
              <Link href="/my-events">
                <Button className="bg-teranga-gold hover:bg-teranga-gold/90">
                  {t("myRegistrations")}
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const visibleTickets = event.ticketTypes.filter((x) => x.isVisible);

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <button
        onClick={() => (step === "select" ? router.back() : setStep("select"))}
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {step === "success" ? t("back") : t("backToEvent")}
      </button>

      <h1 className="text-2xl font-bold">{event.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>

      {step === "select" && (
        <div className="mt-6 space-y-3">
          <h2 className="text-lg font-semibold">{t("selectHeading")}</h2>
          {visibleTickets.map((ticket) => {
            const remaining = ticket.totalQuantity ? ticket.totalQuantity - ticket.soldCount : null;
            const soldOut = remaining !== null && remaining <= 0;

            return (
              <button
                key={ticket.id}
                disabled={soldOut}
                onClick={() => {
                  setSelectedTicket(ticket);
                  setStep("confirm");
                }}
                className={`w-full rounded-lg border p-4 text-left transition-colors ${
                  soldOut
                    ? "cursor-not-allowed opacity-50"
                    : "hover:border-teranga-gold hover:bg-teranga-gold/5"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Ticket className="h-4 w-4 text-teranga-gold" />
                    <span className="font-medium">{ticket.name}</span>
                  </div>
                  <span className="font-semibold text-teranga-gold">
                    {ticket.price === 0
                      ? tCommon("free")
                      : formatCurrency(ticket.price, ticket.currency, regional)}
                  </span>
                </div>
                {ticket.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{ticket.description}</p>
                )}
                {soldOut && (
                  <Badge variant="destructive" className="mt-2">
                    {t("soldOut")}
                  </Badge>
                )}
                {remaining !== null && !soldOut && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("seatsLeft", { count: remaining })}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {step === "confirm" && selectedTicket && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">{t("confirmHeading")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md bg-muted p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">{selectedTicket.name}</span>
                <div className="text-right">
                  {hasDiscount ? (
                    <>
                      <span className="text-sm text-muted-foreground line-through mr-2">
                        {formatCurrency(selectedTicket.price, selectedTicket.currency, regional)}
                      </span>
                      <span className="font-semibold text-teranga-green">
                        {discountedPrice === 0
                          ? tCommon("free")
                          : formatCurrency(discountedPrice, selectedTicket.currency, regional)}
                      </span>
                    </>
                  ) : (
                    <span className="font-semibold text-teranga-gold">
                      {selectedTicket.price === 0
                        ? tCommon("free")
                        : formatCurrency(selectedTicket.price, selectedTicket.currency, regional)}
                    </span>
                  )}
                </div>
              </div>
              {hasDiscount && promoResult && (
                <div className="mt-2 flex items-center gap-2">
                  <Badge
                    variant="secondary"
                    className="bg-teranga-green/10 text-teranga-green text-xs"
                  >
                    <Tag className="h-3 w-3 mr-1" />
                    {promoResult.code} :{" "}
                    {promoResult.discountType === "percentage"
                      ? `-${promoResult.discountValue}%`
                      : `-${formatCurrency(promoResult.discountValue, "XOF", regional)}`}
                  </Badge>
                  <button
                    type="button"
                    onClick={handleRemovePromo}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            {selectedTicket.price > 0 && (
              <div className="rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setPromoOpen(!promoOpen)}
                  className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  <span className="flex items-center gap-2">
                    <Tag className="h-4 w-4" />
                    {t("promoHeading")}
                  </span>
                  {promoOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
                {promoOpen && !promoResult && (
                  <div className="border-t border-border px-4 py-3 space-y-3">
                    <div className="flex gap-2">
                      <Input
                        placeholder={t("promoPlaceholder")}
                        value={promoInput}
                        onChange={(e) => {
                          setPromoInput(e.target.value);
                          setPromoError(null);
                        }}
                        className="flex-1 uppercase"
                        disabled={validatePromo.isPending}
                      />
                      <Button
                        type="button"
                        onClick={handleApplyPromo}
                        disabled={!promoInput.trim() || validatePromo.isPending}
                        className="bg-teranga-gold hover:bg-teranga-gold/90"
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
              </div>
            )}

            {isPaidTicket && discountedPrice > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-foreground">{t("chooseMethod")}</p>
                <div
                  role="radiogroup"
                  aria-label={t("methodAria")}
                  className="grid gap-2 sm:grid-cols-2"
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
                        className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-all ${
                          isSelected
                            ? "border-teranga-gold bg-teranga-gold/5 shadow-sm"
                            : "border-border hover:border-teranga-gold/50"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2"
                          style={{
                            borderColor: isSelected ? method.accent : "#d1d5db",
                            backgroundColor: isSelected ? method.accent : "transparent",
                          }}
                        >
                          {isSelected && <span className="h-2 w-2 rounded-full bg-white" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold" style={{ color: method.accent }}>
                            {method.label}
                          </p>
                          <p className="text-xs text-muted-foreground">{method.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/50">
                  <CreditCard className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    {t("redirectNotice", {
                      method:
                        paymentMethods.find((m) => m.id === selectedMethod)?.label ??
                        t("redirectNoticeFallback"),
                    })}
                  </p>
                </div>
              </div>
            )}

            {event.requiresApproval && !isPaidTicket && (
              <p className="text-sm text-amber-600 dark:text-amber-400">{t("approvalNotice")}</p>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setStep("select");
                  handleRemovePromo();
                }}
                disabled={isSubmitting}
              >
                {t("back")}
              </Button>
              <Button
                className="flex-1 bg-teranga-gold hover:bg-teranga-gold/90"
                onClick={handleConfirm}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {isPaidTicket && (!hasDiscount || discountedPrice > 0)
                      ? t("redirecting")
                      : t("registering")}
                  </span>
                ) : hasDiscount ? (
                  discountedPrice === 0 ? (
                    t("confirmFree")
                  ) : (
                    t("payAmount", {
                      amount: formatCurrency(discountedPrice, selectedTicket.currency, regional),
                    })
                  )
                ) : isPaidTicket ? (
                  t("payAmount", {
                    amount: formatCurrency(selectedTicket.price, selectedTicket.currency, regional),
                  })
                ) : (
                  t("confirm")
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "success" && registration && (
        <div className="mt-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teranga-green/10">
            <CheckCircle className="h-10 w-10 text-teranga-green" />
          </div>
          <h2 className="mt-4 text-xl font-bold">{t("successTitle")}</h2>
          <p className="mt-2 text-muted-foreground">
            {event.requiresApproval ? t("successPendingApproval") : t("successQrReady")}
          </p>

          {registration.qrCodeValue && (
            <div className="mt-6 inline-block rounded-lg bg-white p-4 shadow-md">
              <QRCodeSVG value={registration.qrCodeValue} size={200} level="M" includeMargin />
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link href="/my-events">
              <Button variant="outline">{t("myRegistrations")}</Button>
            </Link>
            <Link href="/events">
              <Button className="bg-teranga-gold hover:bg-teranga-gold/90">
                {t("exploreOthers")}
              </Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
