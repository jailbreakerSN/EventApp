"use client";

import { useState } from "react";
import { Send, Mail, Smartphone, Bell, Clock, CalendarClock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEventBroadcasts, useSendBroadcast } from "@/hooks/use-broadcasts";
import { useEvents } from "@/hooks/use-events";
import { useAuth } from "@/hooks/use-auth";
import {
  Button,
  Card,
  CardContent,
  Input,
  Select,
  Textarea,
  Spinner,
  Badge,
} from "@teranga/shared-ui";
import type { CommunicationChannel, BroadcastRecipientFilter } from "@teranga/shared-types";
import { PlanGate } from "@/components/plan/PlanGate";

const CHANNEL_ICONS: Record<string, typeof Mail> = {
  email: Mail,
  sms: Smartphone,
  push: Bell,
  in_app: Bell,
};

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  push: "Push",
  in_app: "In-app",
};

const FILTER_LABELS: Record<string, string> = {
  all: "Tous les participants",
  checked_in: "Participants enregistres",
  not_checked_in: "Non enregistres",
};

const STATUS_LABELS: Record<
  string,
  { label: string; variant: "default" | "success" | "warning" | "destructive" }
> = {
  draft: { label: "Brouillon", variant: "default" },
  scheduled: { label: "Programmé", variant: "warning" },
  sending: { label: "En cours", variant: "warning" },
  sent: { label: "Envoyé", variant: "success" },
  failed: { label: "Échoué", variant: "destructive" },
};

export default function CommunicationsPage() {
  const t = useTranslations("nav");
  useAuth();
  const { data: eventsData } = useEvents();
  const events = eventsData?.data ?? [];

  const [selectedEventId, setSelectedEventId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [channels, setChannels] = useState<CommunicationChannel[]>(["push", "in_app"]);
  const [filter, setFilter] = useState<BroadcastRecipientFilter>("all");
  const [scheduleMode, setScheduleMode] = useState<"now" | "scheduled">("now");
  const [scheduledAt, setScheduledAt] = useState("");

  const { data: broadcastsData, isLoading } = useEventBroadcasts(selectedEventId || undefined);
  const broadcasts = broadcastsData?.data ?? [];

  const sendBroadcast = useSendBroadcast();

  const toggleChannel = (ch: CommunicationChannel) => {
    setChannels((prev) => (prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]));
  };

  const handleSend = async () => {
    if (!selectedEventId || !title || !body || channels.length === 0) return;
    if (scheduleMode === "scheduled" && !scheduledAt) return;

    const payload: Parameters<typeof sendBroadcast.mutateAsync>[0] = {
      eventId: selectedEventId,
      title,
      body,
      channels,
      recipientFilter: filter,
    };

    if (scheduleMode === "scheduled" && scheduledAt) {
      payload.scheduledAt = new Date(scheduledAt).toISOString();
    }

    await sendBroadcast.mutateAsync(payload);
    setTitle("");
    setBody("");
    setScheduleMode("now");
    setScheduledAt("");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("communications")}</h1>
        <p className="text-muted-foreground">
          Envoyez des messages aux participants de vos evenements
        </p>
      </div>

      {/* Event selector */}
      <Card>
        <CardContent className="py-4">
          <label htmlFor="comm-event-select" className="mb-2 block text-sm font-medium">
            Événement
          </label>
          <Select
            id="comm-event-select"
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
          >
            <option value="">Selectionnez un evenement</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title}
              </option>
            ))}
          </Select>
        </CardContent>
      </Card>

      {selectedEventId && (
        <>
          {/* Compose broadcast */}
          <Card>
            <CardContent className="space-y-4 py-4">
              <h2 className="text-lg font-semibold">Nouveau message</h2>

              <div>
                <label htmlFor="comm-title" className="mb-1 block text-sm font-medium">
                  Titre
                </label>
                <Input
                  id="comm-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Rappel important"
                />
              </div>

              <div>
                <label htmlFor="comm-body" className="mb-1 block text-sm font-medium">
                  Message
                </label>
                <Textarea
                  id="comm-body"
                  rows={4}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Votre message..."
                />
              </div>

              <div>
                <p id="comm-channels-label" className="mb-2 block text-sm font-medium">
                  Canaux
                </p>
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-labelledby="comm-channels-label"
                >
                  {(["push", "sms", "email", "in_app"] as CommunicationChannel[]).map((ch) => {
                    const Icon = CHANNEL_ICONS[ch] ?? Bell;
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
                        {CHANNEL_LABELS[ch]}
                      </button>
                    );
                    if (ch === "sms") {
                      return (
                        <PlanGate key={ch} feature="smsNotifications" fallback="disabled">
                          {btn}
                        </PlanGate>
                      );
                    }
                    return btn;
                  })}
                </div>
              </div>

              <div>
                <label htmlFor="comm-recipients" className="mb-1 block text-sm font-medium">
                  Destinataires
                </label>
                <Select
                  id="comm-recipients"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as BroadcastRecipientFilter)}
                >
                  {Object.entries(FILTER_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>

              {/* Schedule toggle */}
              <div>
                <p className="mb-2 block text-sm font-medium">Planification</p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setScheduleMode("now");
                      setScheduledAt("");
                    }}
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
                      htmlFor="comm-scheduled-at"
                      className="mb-1 block text-sm text-muted-foreground"
                    >
                      Date et heure d&apos;envoi
                    </label>
                    <input
                      id="comm-scheduled-at"
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
                onClick={handleSend}
                disabled={
                  sendBroadcast.isPending ||
                  !title ||
                  !body ||
                  channels.length === 0 ||
                  (scheduleMode === "scheduled" && !scheduledAt)
                }
                className="bg-teranga-gold hover:bg-teranga-gold/90"
              >
                {scheduleMode === "scheduled" ? (
                  <CalendarClock className="mr-2 h-4 w-4" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                {sendBroadcast.isPending
                  ? "Envoi..."
                  : scheduleMode === "scheduled"
                    ? "Programmer"
                    : "Envoyer"}
              </Button>
            </CardContent>
          </Card>

          {/* Broadcast history */}
          <Card>
            <CardContent className="py-4">
              <h2 className="mb-4 text-lg font-semibold">Historique</h2>

              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              ) : broadcasts.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground">Aucun message envoye</p>
              ) : (
                <div className="space-y-3">
                  {broadcasts.map((b) => {
                    const status = STATUS_LABELS[b.status] ?? STATUS_LABELS.draft;
                    return (
                      <div
                        key={b.id}
                        className="flex items-start justify-between rounded-lg border p-3"
                      >
                        <div className="space-y-1">
                          <p className="font-medium">{b.title}</p>
                          <p className="text-sm text-muted-foreground line-clamp-2">{b.body}</p>
                          <div className="flex gap-2 text-xs text-muted-foreground">
                            <span>{b.recipientCount} destinataires</span>
                            <span>{b.sentCount} envoyes</span>
                            {b.failedCount > 0 && (
                              <span className="text-red-500">{b.failedCount} echecs</span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant={status.variant}>{status.label}</Badge>
                          {b.status === "scheduled" && b.scheduledAt ? (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" aria-hidden="true" />
                              Programmé pour le{" "}
                              {new Date(b.scheduledAt).toLocaleDateString("fr-FR", {
                                day: "numeric",
                                month: "long",
                                year: "numeric",
                              })}{" "}
                              à{" "}
                              {new Date(b.scheduledAt).toLocaleTimeString("fr-FR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {b.sentAt ? new Date(b.sentAt).toLocaleDateString("fr-FR") : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
