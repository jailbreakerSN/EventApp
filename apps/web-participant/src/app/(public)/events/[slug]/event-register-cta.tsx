"use client";

import Link from "next/link";
import { ArrowRight, Hourglass, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMyRegistrationForEvent } from "@/hooks/use-registrations";
import { useAuth } from "@/hooks/use-auth";
import type { Registration } from "@teranga/shared-types";

/**
 * Phase A-2 — client-side CTA for the public event detail page.
 *
 * The server-rendered page can't know the viewer's registration state
 * without an auth round-trip per render — so we hydrate the CTA on
 * the client and adapt based on the user's current registration:
 *
 *   - signed out OR no active registration → "S'inscrire à l'événement"
 *     (preserves the original public-CTA behaviour)
 *   - status=pending_payment → "Compléter mon paiement" — links to
 *     the register page where the ExistingRegistrationView surfaces
 *     resume / cancel actions
 *   - status=confirmed / checked_in → "Vous êtes inscrit" + link to
 *     /my-events (no double-register)
 *   - status=pending (approval) → "En attente de validation"
 *   - status=waitlisted → "Sur liste d'attente"
 *
 * Refetch on window focus is enabled in the hook, so a payment that
 * confirms in another tab updates this CTA without a page refresh.
 */
export interface EventRegisterCtaProps {
  eventId: string;
  /** Original CTA label resolved server-side (registerFree / ctaRegister / joinWaitlist). */
  defaultLabel: string;
  /** Sub-label rendered under the button (paymentSecured / freeNoPayment / waitlistNotice). */
  defaultSubLabel: string;
  /** Server-side preflight: if "unavailable" we render the unavailable card; this CTA isn't reached. */
  canRegister: boolean;
  /** Localised "approval required" copy for events with `requiresApproval`. */
  approvalRequiredLabel: string | null;
}

export function EventRegisterCta(props: EventRegisterCtaProps) {
  const { user, loading } = useAuth();
  const t = useTranslations("registerFlow.pendingPayment");
  const tCheckedIn = useTranslations("registerFlow.checkedIn");
  const tWaitlisted = useTranslations("registerFlow.waitlisted");
  const tPending = useTranslations("registerFlow.pendingApproval");
  const tStatus = useTranslations("registerFlow");

  // Always run the hook (Rules of Hooks); rely on `enabled` to no-op
  // when auth isn't ready or user is anonymous.
  const { data, isLoading } = useMyRegistrationForEvent(
    !loading && user && props.canRegister ? props.eventId : undefined,
  );
  const reg = (data as { data?: Registration | null })?.data ?? null;

  // Loading skeleton — keeps the layout stable. Falls through to the
  // default CTA after auth resolves so signed-out visitors never see
  // a stuck spinner.
  if (loading || (user && isLoading && props.canRegister)) {
    return (
      <DefaultCta
        eventId={props.eventId}
        label={props.defaultLabel}
        subLabel={props.defaultSubLabel}
        approvalRequired={props.approvalRequiredLabel}
      />
    );
  }

  // Signed-out: same as before — link to register, the page itself
  // handles the auth gate.
  if (!user || !reg || !props.canRegister) {
    return (
      <DefaultCta
        eventId={props.eventId}
        label={props.defaultLabel}
        subLabel={props.defaultSubLabel}
        approvalRequired={props.approvalRequiredLabel}
      />
    );
  }

  switch (reg.status) {
    case "pending_payment":
      return (
        <Link
          href={`/register/${props.eventId}`}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-teranga-gold px-6 text-sm font-semibold text-teranga-navy transition-colors hover:bg-teranga-gold-light"
        >
          <Hourglass className="h-4 w-4" aria-hidden="true" />
          {tStatus("pendingPayment.resumeCta")}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      );
    case "confirmed":
    case "checked_in":
      return (
        <div className="space-y-2">
          <Link
            href={`/my-events/${reg.id}/badge`}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-teranga-green px-6 text-sm font-semibold text-white transition-colors hover:bg-teranga-green/90"
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            {tStatus("viewBadge")}
          </Link>
          <p className="text-center text-[11px] text-muted-foreground">
            {reg.status === "checked_in" ? tCheckedIn("title") : tStatus("alreadyRegistered")}
          </p>
        </div>
      );
    case "waitlisted":
      return (
        <Link
          href="/my-events"
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-teranga-gold/40 bg-teranga-gold/10 px-6 text-sm font-semibold text-teranga-navy transition-colors hover:bg-teranga-gold/20"
        >
          <Hourglass className="h-4 w-4" aria-hidden="true" />
          {tWaitlisted("title")}
        </Link>
      );
    case "pending":
      return (
        <Link
          href="/my-events"
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border bg-card px-6 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
        >
          {tPending("title")}
        </Link>
      );
    default:
      return (
        <DefaultCta
          eventId={props.eventId}
          label={props.defaultLabel}
          subLabel={props.defaultSubLabel}
          approvalRequired={props.approvalRequiredLabel}
        />
      );
  }

  void t; // unused but kept for future copy changes
}

function DefaultCta({
  eventId,
  label,
  subLabel,
  approvalRequired,
}: {
  eventId: string;
  label: string;
  subLabel: string;
  approvalRequired: string | null;
}) {
  return (
    <>
      <Link
        href={`/register/${eventId}`}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-teranga-navy px-6 text-sm font-semibold text-white transition-colors hover:bg-teranga-navy/90 dark:bg-teranga-gold dark:text-teranga-navy dark:hover:bg-teranga-gold-light"
      >
        {label}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
      <p className="mt-2.5 text-center text-[11px] text-muted-foreground">{subLabel}</p>
      {approvalRequired && (
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">{approvalRequired}</p>
      )}
    </>
  );
}
