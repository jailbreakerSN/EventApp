"use client";

/**
 * Organizer overhaul — Phase O5.
 *
 * Reusable broadcast composer with:
 *  - title + body fields,
 *  - multi-channel selection (push, sms, email, in_app),
 *  - recipient filter (all / checked-in / not-checked-in),
 *  - schedule mode (now / scheduled),
 *  - live preview rendering `{{event}}` / `{{date}}` placeholders,
 *  - template injection via the `template` prop (fed by the
 *    CommsTemplateLibrary picker in the parent page).
 *
 * The component is fully controlled by the parent — it owns the
 * sendBroadcast mutation and the active eventId. This composer is a
 * pure form + preview + submit wrapper. Plan-gating on SMS lives
 * inside the channel toggle.
 */

import { useEffect, useState } from "react";
import { Send, CalendarClock, Mail, Smartphone, Bell, Eye, MessageCircle } from "lucide-react";
import { Button, Card, CardContent, Input, Select, Textarea } from "@teranga/shared-ui";
import { PlanGate } from "@/components/plan/PlanGate";
import {
  renderCommsTemplate,
  type CommsTemplate,
  type CommunicationChannel,
  type BroadcastRecipientFilter,
} from "@teranga/shared-types";

export interface CommsComposerSubmit {
  title: string;
  body: string;
  channels: CommunicationChannel[];
  filter: BroadcastRecipientFilter;
  scheduledAt: string | null;
}

export interface CommsComposerProps {
  /** Suggested template — when it changes, the form fields update. */
  template?: CommsTemplate | null;
  /** Active event title used to render `{{event}}` in the preview. */
  eventTitle?: string;
  /** Active event start date (ISO) used to render `{{date}}` in the preview. */
  eventStartDate?: string | null;
  /** Disabled while the parent's mutation is in-flight. */
  busy?: boolean;
  /** Called when the user clicks the submit button. */
  onSubmit: (payload: CommsComposerSubmit) => void;
}

const CHANNEL_LABEL: Record<CommunicationChannel, string> = {
  push: "Push",
  sms: "SMS",
  email: "Email",
  whatsapp: "WhatsApp",
  in_app: "In-app",
};

const CHANNEL_ICON: Record<CommunicationChannel, typeof Mail> = {
  push: Bell,
  sms: Smartphone,
  email: Mail,
  whatsapp: MessageCircle,
  in_app: Bell,
};

const FILTER_LABEL: Record<BroadcastRecipientFilter, string> = {
  all: "Tous les participants",
  checked_in: "Participants enregistrés",
  not_checked_in: "Non enregistrés",
};

export function CommsComposer({
  template,
  eventTitle,
  eventStartDate,
  busy = false,
  onSubmit,
}: CommsComposerProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [channels, setChannels] = useState<CommunicationChannel[]>(["push", "in_app"]);
  const [filter, setFilter] = useState<BroadcastRecipientFilter>("all");
  const [scheduleMode, setScheduleMode] = useState<"now" | "scheduled">("now");
  const [scheduledAt, setScheduledAt] = useState("");

  // When a new template is picked, hydrate the form fields. We avoid
  // a deep dependency comparison: parent passes a fresh object on
  // every pick, so identity-equality is good enough.
  useEffect(() => {
    if (!template) return;
    setTitle(template.title);
    setBody(template.body);
    setChannels(template.defaultChannels);
  }, [template]);

  const toggleChannel = (ch: CommunicationChannel) => {
    setChannels((prev) => (prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]));
  };

  const formattedDate = eventStartDate
    ? new Date(eventStartDate).toLocaleDateString("fr-SN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  const previewVars = {
    event: eventTitle ?? undefined,
    date: formattedDate ?? undefined,
    participant: "le participant",
  };
  const previewTitle = renderCommsTemplate(title, previewVars);
  const previewBody = renderCommsTemplate(body, previewVars);

  const canSubmit =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    channels.length > 0 &&
    (scheduleMode === "now" || (scheduleMode === "scheduled" && scheduledAt.length > 0)) &&
    !busy;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      title: title.trim(),
      body: body.trim(),
      channels,
      filter,
      scheduledAt: scheduleMode === "scheduled" ? new Date(scheduledAt).toISOString() : null,
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Composer form */}
      <Card>
        <CardContent className="space-y-4 py-5">
          <h2 className="text-lg font-semibold">Nouveau message</h2>

          <div>
            <label htmlFor="composer-title" className="mb-1 block text-sm font-medium">
              Titre
            </label>
            <Input
              id="composer-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Rappel important"
              maxLength={200}
            />
          </div>

          <div>
            <label htmlFor="composer-body" className="mb-1 block text-sm font-medium">
              Message
            </label>
            <Textarea
              id="composer-body"
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Votre message…"
              maxLength={2000}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Variables disponibles : <code>{"{{event}}"}</code>, <code>{"{{date}}"}</code>,{" "}
              <code>{"{{participant}}"}</code>
            </p>
          </div>

          <div>
            <p id="composer-channels-label" className="mb-2 block text-sm font-medium">
              Canaux
            </p>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-labelledby="composer-channels-label"
            >
              {(["push", "sms", "whatsapp", "email", "in_app"] as CommunicationChannel[]).map(
                (ch) => {
                  const Icon = CHANNEL_ICON[ch];
                  const selected = channels.includes(ch);
                  const btn = (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => toggleChannel(ch)}
                      aria-pressed={selected}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium motion-safe:transition-colors ${
                        selected
                          ? "border-teranga-gold bg-teranga-gold/10 text-teranga-gold"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {CHANNEL_LABEL[ch]}
                    </button>
                  );
                  if (ch === "sms") {
                    return (
                      <PlanGate key={ch} feature="smsNotifications" fallback="disabled">
                        {btn}
                      </PlanGate>
                    );
                  }
                  if (ch === "whatsapp") {
                    return (
                      <PlanGate key={ch} feature="whatsappNotifications" fallback="disabled">
                        {btn}
                      </PlanGate>
                    );
                  }
                  return btn;
                },
              )}
            </div>
          </div>

          <div>
            <label htmlFor="composer-recipients" className="mb-1 block text-sm font-medium">
              Destinataires
            </label>
            <Select
              id="composer-recipients"
              value={filter}
              onChange={(e) => setFilter(e.target.value as BroadcastRecipientFilter)}
            >
              {(Object.keys(FILTER_LABEL) as BroadcastRecipientFilter[]).map((value) => (
                <option key={value} value={value}>
                  {FILTER_LABEL[value]}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <p className="mb-2 block text-sm font-medium">Planification</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setScheduleMode("now");
                  setScheduledAt("");
                }}
                aria-pressed={scheduleMode === "now"}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium motion-safe:transition-colors ${
                  scheduleMode === "now"
                    ? "border-teranga-gold bg-teranga-gold/10 text-teranga-gold"
                    : "border-border text-muted-foreground"
                }`}
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                Envoyer maintenant
              </button>
              <button
                type="button"
                onClick={() => setScheduleMode("scheduled")}
                aria-pressed={scheduleMode === "scheduled"}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium motion-safe:transition-colors ${
                  scheduleMode === "scheduled"
                    ? "border-teranga-gold bg-teranga-gold/10 text-teranga-gold"
                    : "border-border text-muted-foreground"
                }`}
              >
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                Programmer l&apos;envoi
              </button>
            </div>
            {scheduleMode === "scheduled" && (
              <div className="mt-3">
                <label
                  htmlFor="composer-scheduled-at"
                  className="mb-1 block text-sm text-muted-foreground"
                >
                  Date et heure d&apos;envoi
                </label>
                <input
                  id="composer-scheduled-at"
                  type="datetime-local"
                  value={scheduledAt}
                  min={new Date().toISOString().slice(0, 16)}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
            )}
          </div>

          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-teranga-gold hover:bg-teranga-gold/90"
          >
            {scheduleMode === "scheduled" ? (
              <CalendarClock className="mr-2 h-4 w-4" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {busy ? "Envoi…" : scheduleMode === "scheduled" ? "Programmer" : "Envoyer"}
          </Button>
        </CardContent>
      </Card>

      {/* Live preview */}
      <Card className="bg-muted/30">
        <CardContent className="space-y-3 py-5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            Aperçu
          </div>
          <div className="rounded-md border border-border bg-background p-4 space-y-2">
            <p className="text-sm font-semibold text-foreground">
              {previewTitle || "Titre du message…"}
            </p>
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {previewBody || "Le contenu du message apparaîtra ici."}
            </p>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Le rendu utilise le titre + la date de l&apos;événement actif. Le nom du participant est
            remplacé par <code>« le participant »</code> pour la prévisualisation.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
