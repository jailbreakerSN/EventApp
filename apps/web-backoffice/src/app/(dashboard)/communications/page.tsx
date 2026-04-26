"use client";

/**
 * Organizer overhaul — Phase O5.
 *
 * Comms Center landing — three tabs (Frise / Composer / Bibliothèque)
 * organized around a single active event selector at the top. Replaces
 * the previous single-purpose composer page.
 *
 * IA principles:
 *  - One tab is always active. Default = Frise (Timeline) so the
 *    organizer first sees what's already in the queue, before
 *    composing more noise.
 *  - The event selector sits OUTSIDE the tab strip — it scopes the
 *    Timeline + Composer (which are event-bound). The Templates tab
 *    works without an event (templates are org-scoped product copy).
 *  - Picking a template in the Library auto-switches to the Composer
 *    tab with the form pre-filled — single-click flow from inspiration
 *    to ready-to-send draft.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, Library, Send } from "lucide-react";
import { Card, CardContent, Select } from "@teranga/shared-ui";
import { useEvents } from "@/hooks/use-events";
import { useEventBroadcasts, useSendBroadcast } from "@/hooks/use-broadcasts";
import { useEventCommsTimeline } from "@/hooks/use-comms-timeline";
import { CommsTimeline } from "@/components/comms/CommsTimeline";
import { CommsComposer, type CommsComposerSubmit } from "@/components/comms/CommsComposer";
import { CommsTemplateLibrary } from "@/components/comms/CommsTemplateLibrary";
import { cn } from "@/lib/utils";
import type { CommsTemplate } from "@teranga/shared-types";

type Tab = "timeline" | "composer" | "library";

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: typeof CalendarClock }> = [
  { id: "timeline", label: "Frise", icon: CalendarClock },
  { id: "composer", label: "Composer", icon: Send },
  { id: "library", label: "Bibliothèque", icon: Library },
];

export default function CommunicationsPage() {
  const t = useTranslations("nav");
  const { data: eventsData } = useEvents();
  const events = eventsData?.data ?? [];

  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<Tab>("timeline");
  const [pickedTemplate, setPickedTemplate] = useState<CommsTemplate | null>(null);

  const selectedEvent = events.find((e) => e.id === selectedEventId);

  const { data: timelineData } = useEventCommsTimeline(selectedEventId || undefined);
  const sendBroadcast = useSendBroadcast();
  // Reuse the existing `useEventBroadcasts` for the textual history
  // listed under the timeline (compact list of recent sends).
  const { data: broadcastsData } = useEventBroadcasts(selectedEventId || undefined);
  const recentBroadcasts = (broadcastsData?.data ?? []).slice(0, 5);

  const handleComposerSubmit = async (payload: CommsComposerSubmit) => {
    if (!selectedEventId) return;
    await sendBroadcast.mutateAsync({
      eventId: selectedEventId,
      title: payload.title,
      body: payload.body,
      channels: payload.channels,
      recipientFilter: payload.filter,
      ...(payload.scheduledAt ? { scheduledAt: payload.scheduledAt } : {}),
    });
  };

  const handleTemplatePick = (template: CommsTemplate) => {
    setPickedTemplate(template);
    setActiveTab("composer");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("communications")}</h1>
        <p className="text-muted-foreground">
          Frise des envois, composer multi-canaux et bibliothèque de templates — tout en une vue.
        </p>
      </div>

      {/* Event selector — applies to Timeline + Composer */}
      <Card>
        <CardContent className="py-4">
          <label htmlFor="comms-event-select" className="mb-2 block text-sm font-medium">
            Événement
          </label>
          <Select
            id="comms-event-select"
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
          >
            <option value="">Sélectionnez un événement</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title}
              </option>
            ))}
          </Select>
        </CardContent>
      </Card>

      {/* Tab strip */}
      <nav
        className="flex gap-1 border-b border-border overflow-x-auto scrollbar-none"
        aria-label="Sections du Comms Center"
      >
        {TABS.map((tab) => {
          const active = tab.id === activeTab;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 motion-safe:transition-colors whitespace-nowrap",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Tab content */}
      {activeTab === "timeline" && (
        <div className="space-y-4">
          {!selectedEventId ? (
            <Card className="border-dashed">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                Sélectionnez un événement pour voir la frise des communications.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardContent className="p-4">
                  <CommsTimeline data={timelineData} />
                </CardContent>
              </Card>
              {recentBroadcasts.length > 0 && (
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Derniers envois
                    </h3>
                    <ul className="space-y-2">
                      {recentBroadcasts.map((b) => (
                        <li
                          key={b.id}
                          className="flex items-start justify-between rounded-md border border-border p-3"
                        >
                          <div>
                            <p className="text-sm font-medium text-foreground">{b.title}</p>
                            <p className="text-xs text-muted-foreground line-clamp-1">{b.body}</p>
                          </div>
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            {b.sentCount}/{b.recipientCount} envoyés
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === "composer" && (
        <>
          {!selectedEventId ? (
            <Card className="border-dashed">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                Sélectionnez un événement pour composer un message.
              </CardContent>
            </Card>
          ) : (
            <CommsComposer
              template={pickedTemplate}
              eventTitle={selectedEvent?.title}
              eventStartDate={selectedEvent?.startDate ?? null}
              busy={sendBroadcast.isPending}
              onSubmit={handleComposerSubmit}
            />
          )}
        </>
      )}

      {activeTab === "library" && <CommsTemplateLibrary onPick={handleTemplatePick} />}
    </div>
  );
}
