"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Clock, Hourglass, Loader2, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@teranga/shared-ui";
import type { Event, Registration } from "@teranga/shared-types";

/**
 * Phase A — UX state-machine view for an existing registration.
 *
 * Replaces the prior shape where every non-cancelled registration
 * landed on the same "Vous êtes déjà inscrit + QR + Voir mon badge"
 * screen, regardless of whether the user had actually paid.
 *
 * The status discriminator drives:
 *   - confirmed / checked_in → badge view (current behaviour)
 *   - pending_payment        → "Paiement en cours" with Resume + Cancel
 *   - waitlisted             → waitlist position info
 *   - pending (approval)     → "En attente de validation"
 *
 * The QR + "Voir mon badge" CTA are NEVER shown for non-confirmed
 * states — defence-in-depth on top of the API guard at
 * `apps/api/src/services/badge.service.ts:99,322,389` which already
 * rejects badge reads for non-confirmed registrations.
 *
 * Translations are passed in as props so this component stays a pure
 * view (no `useTranslations` import) — easier to test in isolation
 * and to reuse from a Storybook story.
 */
export interface ExistingRegistrationViewProps {
  registration: Registration;
  event: Event;
  onBack: () => void;
  /** Phase B-2 — re-fetch the existing PayDunya redirectUrl + window.location. */
  onResumePayment: () => Promise<void> | void;
  /** Phase B-3 — flip Reg → cancelled, Payment → expired. */
  onCancelPending: () => Promise<void> | void;
  isResumeBusy: boolean;
  isCancelBusy: boolean;
  translations: {
    backToEvent: string;
    alreadyRegistered: string;
    statusPrefix: (status: string) => string;
    viewBadge: string;
    myRegistrations: string;
    pendingTitle: string;
    pendingDescription: string;
    resumeCta: string;
    cancelCta: string;
    checkedInTitle: string;
    checkedInDescription: string;
    waitlistedTitle: string;
    waitlistedDescription: string;
    pendingApprovalTitle: string;
    pendingApprovalDescription: string;
    statusLabel: string;
  };
}

export function ExistingRegistrationView(props: ExistingRegistrationViewProps) {
  const { registration, event, onBack, translations: t } = props;
  const status = registration.status;

  return (
    <div className="mx-auto max-w-xl px-6 py-12 lg:px-8">
      <button
        onClick={onBack}
        className="mb-6 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t.backToEvent}
      </button>
      <h1 className="font-serif-display text-3xl font-semibold tracking-[-0.02em]">
        {event.title}
      </h1>
      <div className="mt-8 rounded-tile border bg-card p-8 text-center">
        {status === "pending_payment" ? (
          <PendingPaymentBlock
            registration={registration}
            translations={t}
            onResume={props.onResumePayment}
            onCancel={props.onCancelPending}
            isResumeBusy={props.isResumeBusy}
            isCancelBusy={props.isCancelBusy}
          />
        ) : status === "pending" ? (
          <PendingApprovalBlock translations={t} />
        ) : status === "waitlisted" ? (
          <WaitlistedBlock translations={t} />
        ) : status === "checked_in" ? (
          <CheckedInBlock translations={t} />
        ) : (
          <ConfirmedBlock registration={registration} translations={t} />
        )}
      </div>
    </div>
  );
}

// ─── Status blocks ─────────────────────────────────────────────────────────

function ConfirmedBlock({
  registration,
  translations: t,
}: {
  registration: Registration;
  translations: ExistingRegistrationViewProps["translations"];
}) {
  return (
    <>
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teranga-green/10">
        <Check className="h-10 w-10 text-teranga-green" strokeWidth={2.5} />
      </div>
      <h2 className="font-serif-display mt-4 text-xl font-semibold">{t.alreadyRegistered}</h2>
      <p className="mt-2 text-muted-foreground">{t.statusPrefix(t.statusLabel)}</p>
      {/* QR is shown ONLY for confirmed (the API gate already enforces
          this for the badge endpoint, but the local QR is a denormalised
          copy on the registration doc — defence-in-depth here keeps a
          stale or pre-confirmation QR off-screen). */}
      {registration.qrCodeValue && (
        <div className="mt-6 inline-block rounded-card bg-white p-4 shadow-md">
          <QRCodeSVG value={registration.qrCodeValue} size={180} level="M" includeMargin />
        </div>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Link href={`/my-events/${registration.id}/badge`}>
          <Button variant="outline">{t.viewBadge}</Button>
        </Link>
        <Link href="/my-events">
          <Button className="bg-teranga-navy text-white hover:bg-teranga-navy/90">
            {t.myRegistrations}
          </Button>
        </Link>
      </div>
    </>
  );
}

function PendingPaymentBlock({
  registration,
  translations: t,
  onResume,
  onCancel,
  isResumeBusy,
  isCancelBusy,
}: {
  registration: Registration;
  translations: ExistingRegistrationViewProps["translations"];
  onResume: () => Promise<void> | void;
  onCancel: () => Promise<void> | void;
  isResumeBusy: boolean;
  isCancelBusy: boolean;
}) {
  return (
    <>
      <div
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teranga-gold/10"
        aria-hidden="true"
      >
        <Hourglass className="h-9 w-9 text-teranga-gold-dark" strokeWidth={2} />
      </div>
      <h2 className="font-serif-display mt-4 text-xl font-semibold">{t.pendingTitle}</h2>
      <p className="mt-2 text-muted-foreground">{t.pendingDescription}</p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
        {/* Resume button is disabled when no paymentId is linked
            (defensive — should always be set when status=pending_payment
            but the cancelPending branch tolerates absent paymentId). */}
        <Button
          onClick={() => void onResume()}
          disabled={!registration.paymentId || isResumeBusy || isCancelBusy}
          className="bg-teranga-navy text-white hover:bg-teranga-navy/90"
          aria-busy={isResumeBusy}
        >
          {isResumeBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          )}
          {t.resumeCta}
        </Button>
        <Button
          variant="outline"
          onClick={() => void onCancel()}
          disabled={isResumeBusy || isCancelBusy}
          aria-busy={isCancelBusy}
        >
          {isCancelBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <X className="h-4 w-4" aria-hidden="true" />
          )}
          {t.cancelCta}
        </Button>
      </div>
    </>
  );
}

function PendingApprovalBlock({
  translations: t,
}: {
  translations: ExistingRegistrationViewProps["translations"];
}) {
  return (
    <>
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teranga-clay/10">
        <Clock className="h-9 w-9 text-teranga-clay-dark" strokeWidth={2} />
      </div>
      <h2 className="font-serif-display mt-4 text-xl font-semibold">
        {t.pendingApprovalTitle}
      </h2>
      <p className="mt-2 text-muted-foreground">{t.pendingApprovalDescription}</p>
      <div className="mt-6">
        <Link href="/my-events">
          <Button variant="outline">{t.myRegistrations}</Button>
        </Link>
      </div>
    </>
  );
}

function WaitlistedBlock({
  translations: t,
}: {
  translations: ExistingRegistrationViewProps["translations"];
}) {
  return (
    <>
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teranga-gold/10">
        <Hourglass className="h-9 w-9 text-teranga-gold-dark" strokeWidth={2} />
      </div>
      <h2 className="font-serif-display mt-4 text-xl font-semibold">{t.waitlistedTitle}</h2>
      <p className="mt-2 text-muted-foreground">{t.waitlistedDescription}</p>
      <div className="mt-6">
        <Link href="/my-events">
          <Button variant="outline">{t.myRegistrations}</Button>
        </Link>
      </div>
    </>
  );
}

function CheckedInBlock({
  translations: t,
}: {
  translations: ExistingRegistrationViewProps["translations"];
}) {
  return (
    <>
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-teranga-green/10">
        <Check className="h-10 w-10 text-teranga-green" strokeWidth={2.5} />
      </div>
      <h2 className="font-serif-display mt-4 text-xl font-semibold">{t.checkedInTitle}</h2>
      <p className="mt-2 text-muted-foreground">{t.checkedInDescription}</p>
      <div className="mt-6">
        <Link href="/my-events">
          <Button variant="outline">{t.myRegistrations}</Button>
        </Link>
      </div>
    </>
  );
}
