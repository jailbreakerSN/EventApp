"use client";

/**
 * Organizer overhaul — Phase O8.
 *
 * Modal that fires the multi-channel emergency broadcast. Two-step
 * confirmation (intentional friction — this surface should never be a
 * single-tap accident during a live event):
 *
 *   1. **Compose**  — title, body (≤500 chars), reason, channels
 *      (push + sms locked ON by default; whatsapp + email opt-in).
 *   2. **Confirm**  — re-state the channels + recipient count + the
 *      typed reason. The "Diffuser" button is disabled until the
 *      operator types `DIFFUSER` in a confirmation field.
 *
 * UX decisions:
 *  - Push + SMS hard-default at confirm step (locked checkboxes,
 *    explicit explanation: "Canaux requis pour une alerte d'urgence").
 *    Operator can ADD whatsapp / in_app, not remove the locked pair.
 *  - The body is intentionally limited to 500 chars (SMS friendly +
 *    push body limits; longer copy belongs in a regular broadcast).
 *  - Result toast surfaces dispatched count + per-channel breakdown.
 *
 * Plan + opt-in gating happens server-side; the UI shows greyed-out
 * channels with a tooltip when the org plan disables one.
 */

import { useState, useEffect, type FormEvent } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  InlineErrorBanner,
  Input,
  Textarea,
} from "@teranga/shared-ui";
import { AlertTriangle, MessageCircle, Send, ShieldAlert, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useEmergencyBroadcast } from "@/hooks/use-live-ops";
import { useErrorHandler, type ResolvedError } from "@/hooks/use-error-handler";
import type { CommunicationChannel, EmergencyBroadcastDto } from "@teranga/shared-types";

const CHANNEL_LABEL: Record<CommunicationChannel, string> = {
  push: "Notification push",
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "Email",
  in_app: "In-app",
};

// "Required" channels — locked ON. The server enforces the same rule
// (defense in depth) so a malicious client can't strip them.
const LOCKED_CHANNELS: ReadonlySet<CommunicationChannel> = new Set(["push", "sms"]);

// Channels surfaced in the dialog — locked first, then the rest. Email
// is intentionally OFF the optional list (emergency = real-time;
// inbox lag defeats the purpose).
const SELECTABLE_CHANNELS: ReadonlyArray<CommunicationChannel> = [
  "push",
  "sms",
  "whatsapp",
  "in_app",
];

const CHANNEL_ICON: Record<CommunicationChannel, typeof Smartphone> = {
  push: Smartphone,
  sms: MessageCircle,
  whatsapp: MessageCircle,
  in_app: MessageCircle,
  email: MessageCircle,
};

const CONFIRM_PHRASE = "DIFFUSER";

export interface EmergencyBroadcastDialogProps {
  eventId: string;
  open: boolean;
  onClose: () => void;
  /** Whether the org plan allows WhatsApp dispatch — checkbox disabled when false. */
  whatsappEnabled?: boolean;
}

type Step = "compose" | "confirm";

export function EmergencyBroadcastDialog({
  eventId,
  open,
  onClose,
  whatsappEnabled = false,
}: EmergencyBroadcastDialogProps) {
  const broadcast = useEmergencyBroadcast(eventId);
  const { resolve: resolveError } = useErrorHandler();

  const [step, setStep] = useState<Step>("compose");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const [channels, setChannels] = useState<Set<CommunicationChannel>>(
    () => new Set(["push", "sms"]),
  );
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<ResolvedError | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Reset state every time the dialog re-opens — avoids leaking the
  // previous broadcast's draft into the next one.
  useEffect(() => {
    if (open) {
      setStep("compose");
      setTitle("");
      setBody("");
      setReason("");
      setChannels(new Set(["push", "sms"]));
      setConfirmText("");
      setError(null);
      setValidationError(null);
    }
  }, [open]);

  const toggleChannel = (channel: CommunicationChannel) => {
    if (LOCKED_CHANNELS.has(channel)) return;
    if (channel === "whatsapp" && !whatsappEnabled) return;
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return next;
    });
  };

  const goToConfirm = (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    if (title.trim().length === 0) {
      setValidationError("Le titre est requis.");
      return;
    }
    if (body.trim().length === 0) {
      setValidationError("Le message est requis.");
      return;
    }
    if (reason.trim().length === 0) {
      setValidationError("Le motif est requis (audit obligatoire).");
      return;
    }
    setStep("confirm");
  };

  const send = async () => {
    setError(null);
    if (confirmText.trim().toUpperCase() !== CONFIRM_PHRASE) {
      setValidationError(`Tapez exactement "${CONFIRM_PHRASE}" pour confirmer la diffusion.`);
      return;
    }
    const dto: EmergencyBroadcastDto = {
      title: title.trim(),
      body: body.trim(),
      reason: reason.trim(),
      channels: Array.from(channels),
    };
    try {
      const result = await broadcast.mutateAsync(dto);
      const breakdown = Object.entries(result.perChannel)
        .map(([k, v]) => `${CHANNEL_LABEL[k as CommunicationChannel] ?? k}: ${v}`)
        .join(" · ");
      toast.success(`Alerte diffusée · ${result.dispatchedCount} message(s) envoyé(s)`, {
        description: breakdown,
      });
      onClose();
    } catch (err) {
      setError(resolveError(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <ShieldAlert className="h-5 w-5" aria-hidden="true" />
            Alerte d&apos;urgence
          </DialogTitle>
          <DialogDescription>
            {step === "compose"
              ? "Diffusez un message immédiat à tous les inscrits sur plusieurs canaux. Toute alerte est tracée dans l'audit."
              : "Confirmez la diffusion. Cette action ne peut pas être annulée."}
          </DialogDescription>
        </DialogHeader>

        {validationError && (
          <InlineErrorBanner
            severity="warning"
            title="Champ manquant"
            description={validationError}
            onDismiss={() => setValidationError(null)}
            dismissLabel="Fermer"
          />
        )}

        {error && (
          <InlineErrorBanner
            title={error.title}
            description={error.description}
            onDismiss={() => setError(null)}
            dismissLabel="Fermer"
          />
        )}

        {step === "compose" && (
          <form onSubmit={goToConfirm} className="space-y-4">
            <FormField label="Titre (push)" htmlFor="emergency-title">
              <Input
                id="emergency-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="Évacuation immédiate"
                required
              />
            </FormField>

            <FormField label="Message" htmlFor="emergency-body">
              <Textarea
                id="emergency-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Quittez le hall A par les sorties latérales. Suivez les consignes du staff."
                required
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {body.length}/500 caractères — court et factuel.
              </p>
            </FormField>

            <FormField label="Motif (audit)" htmlFor="emergency-reason">
              <Input
                id="emergency-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder="Alerte incendie déclenchée"
                required
              />
            </FormField>

            <div>
              <p className="text-sm font-medium mb-2">Canaux</p>
              <div className="space-y-1.5">
                {SELECTABLE_CHANNELS.map((channel) => {
                  const Icon = CHANNEL_ICON[channel];
                  const locked = LOCKED_CHANNELS.has(channel);
                  const disabledByPlan = channel === "whatsapp" && !whatsappEnabled;
                  const checked = channels.has(channel);
                  return (
                    <label
                      key={channel}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-2 rounded-md border border-border text-sm cursor-pointer",
                        checked && "bg-accent/40 border-primary/40",
                        (locked || disabledByPlan) && "cursor-not-allowed opacity-80",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={locked || disabledByPlan}
                        onChange={() => toggleChannel(channel)}
                        className="h-4 w-4 accent-teranga-gold"
                      />
                      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      <span className="flex-1">{CHANNEL_LABEL[channel]}</span>
                      {locked && (
                        <span className="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400">
                          Requis
                        </span>
                      )}
                      {disabledByPlan && (
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Plan requis
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 flex items-start gap-1">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" aria-hidden="true" />
                Push + SMS sont obligatoires pour une alerte d&apos;urgence.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Annuler
              </Button>
              <Button type="submit" variant="destructive">
                Continuer
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === "confirm" && (
          <div className="space-y-4">
            <div className="rounded-md border border-red-200 dark:border-red-900/60 bg-red-50/60 dark:bg-red-950/30 p-3 text-sm">
              <p className="font-semibold text-red-700 dark:text-red-400 mb-1">{title}</p>
              <p className="text-foreground/90 whitespace-pre-wrap">{body}</p>
              <p className="text-[11px] text-muted-foreground mt-2">
                Motif : <span className="text-foreground">{reason}</span>
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Canaux :{" "}
                {Array.from(channels)
                  .map((c) => CHANNEL_LABEL[c])
                  .join(" · ")}
              </p>
            </div>

            <FormField
              label={`Tapez "${CONFIRM_PHRASE}" pour confirmer`}
              htmlFor="emergency-confirm"
            >
              <Input
                id="emergency-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={CONFIRM_PHRASE}
                autoComplete="off"
              />
            </FormField>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep("compose")}
                disabled={broadcast.isPending}
              >
                Retour
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={send}
                disabled={
                  broadcast.isPending || confirmText.trim().toUpperCase() !== CONFIRM_PHRASE
                }
              >
                <Send className="h-4 w-4 mr-1.5" aria-hidden="true" />
                {broadcast.isPending ? "Diffusion…" : "Diffuser maintenant"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
