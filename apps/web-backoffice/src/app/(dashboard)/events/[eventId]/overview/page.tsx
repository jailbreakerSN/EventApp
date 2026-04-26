"use client";

/**
 * Organizer overhaul — Phase O4.
 *
 * "Vue d'ensemble" — landing of the event-detail surface.
 *
 * The page hoists the Phase O3 EventHealthCard to the top (the
 * organizer's first signal on what's healthy / at risk) and surfaces
 * three "priority actions" derived from the health components: every
 * un-earned criterion becomes a one-line CTA pointing at the
 * configuration sub-page that addresses it.
 *
 * Loading + error states delegate to the EventHealthCard's own
 * fallbacks; the priority list renders an empty state ("Tout est
 * prêt !") when every criterion is fully earned.
 */

import { useParams } from "next/navigation";
import Link from "next/link";
import { useMemo } from "react";
import { Card, CardContent, Skeleton } from "@teranga/shared-ui";
import { CheckCircle2, ArrowRight, AlertTriangle, Radio, FileBarChart } from "lucide-react";
import { EventHealthCard } from "@/components/event-health/EventHealthCard";
import { useEventHealth } from "@/hooks/use-event-health";
import { useEvent } from "@/hooks/use-events";
import { liveWindowState } from "@/lib/live-window";
import { cn } from "@/lib/utils";

const COMPONENT_CTA: Record<string, { href: (id: string) => string; ctaLabel: string }> = {
  publication: {
    href: (id) => `/events/${id}/configuration/infos`,
    ctaLabel: "Publier l'événement",
  },
  tickets: {
    href: (id) => `/events/${id}/configuration/tickets`,
    ctaLabel: "Configurer les billets",
  },
  venue: {
    href: (id) => `/events/${id}/configuration/infos`,
    ctaLabel: "Ajouter un lieu",
  },
  pace: {
    href: (id) => `/events/${id}/audience/registrations`,
    ctaLabel: "Voir les inscriptions",
  },
  comms: {
    href: () => `/communications`,
    ctaLabel: "Lancer une campagne",
  },
  staff: {
    href: () => `/organization`,
    ctaLabel: "Inviter du staff",
  },
  checkin: {
    href: () => `/badges`,
    ctaLabel: "Créer un modèle de badge",
  },
};

export default function EventOverviewPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { data: snapshot, isLoading } = useEventHealth(eventId);
  const { data: eventResp } = useEvent(eventId ?? "");
  const event = eventResp?.data;

  // Priority actions = un-earned components, sorted by weight DESC
  // (impact-first). Capped at 5 so the panel stays scannable.
  const priorities = snapshot
    ? snapshot.components
        .filter((c) => c.earned < c.max)
        .sort((a, b) => b.max - a.max)
        .slice(0, 5)
    : [];

  // J-0 ±6 h gate for the "Lancer le mode live" entry point. We do
  // NOT hide the button outside the window — we just disable it and
  // explain why so operators don't think the feature is missing.
  const liveState = useMemo(() => {
    if (!event) return "before" as const;
    return liveWindowState(event.startDate, event.endDate ?? null, new Date());
  }, [event]);

  const liveEnabled = liveState === "live" && event?.status === "published";

  return (
    <div className="space-y-6">
      <EventHealthCard eventId={eventId} />

      {/* Live event mode entry point */}
      {event?.status === "published" && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "inline-flex h-9 w-9 items-center justify-center rounded-full",
                    liveEnabled
                      ? "bg-red-500/15 text-red-600 dark:text-red-400"
                      : "bg-muted text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  <Radio className={cn("h-4 w-4", liveEnabled && "motion-safe:animate-pulse")} />
                </span>
                <div>
                  <p className="text-sm font-semibold">Mode live (Floor Ops)</p>
                  <p className="text-xs text-muted-foreground">
                    {liveState === "live"
                      ? "Tableau de bord temps réel : scans, file, incidents, radio staff."
                      : liveState === "before"
                        ? "Disponible 6 heures avant le début de l'événement."
                        : "L'événement est terminé. Le mode live n'est plus utile."}
                  </p>
                </div>
              </div>
              {liveEnabled ? (
                <Link
                  href={`/events/${eventId}/live`}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2"
                >
                  <Radio className="h-4 w-4" aria-hidden="true" />
                  Lancer le mode live
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  title={liveState === "before" ? "Disponible J-0 ± 6 h" : "Événement terminé"}
                  className="inline-flex items-center gap-2 rounded-lg bg-muted text-muted-foreground text-sm font-medium px-4 py-2 cursor-not-allowed"
                >
                  <Radio className="h-4 w-4" aria-hidden="true" />
                  Lancer le mode live
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Post-event report entry point — surfaced once the event has
          ended (liveState === "after"). Inactive but visible during
          earlier states so the operator knows the surface exists. */}
      {event?.status === "published" && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "inline-flex h-9 w-9 items-center justify-center rounded-full",
                    liveState === "after"
                      ? "bg-teranga-gold/15 text-teranga-gold-dark"
                      : "bg-muted text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  <FileBarChart className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Rapport post-événement</p>
                  <p className="text-xs text-muted-foreground">
                    {liveState === "after"
                      ? "Présence, comms, finances + export PDF + cohorte CSV."
                      : "Disponible une fois l'événement terminé."}
                  </p>
                </div>
              </div>
              {liveState === "after" ? (
                <Link
                  href={`/events/${eventId}/post-event`}
                  className="inline-flex items-center gap-2 rounded-lg bg-foreground hover:bg-foreground/90 text-background text-sm font-medium px-4 py-2"
                >
                  <FileBarChart className="h-4 w-4" aria-hidden="true" />
                  Ouvrir le rapport
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  title="Disponible après la fin de l'événement"
                  className="inline-flex items-center gap-2 rounded-lg bg-muted text-muted-foreground text-sm font-medium px-4 py-2 cursor-not-allowed"
                >
                  <FileBarChart className="h-4 w-4" aria-hidden="true" />
                  Ouvrir le rapport
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Actions prioritaires
          </h2>
          {isLoading ? (
            <div className="mt-3 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} variant="text" className="h-9 w-full" />
              ))}
            </div>
          ) : priorities.length === 0 ? (
            <div className="mt-4 flex items-center gap-3 rounded-md bg-emerald-50/60 p-4 dark:bg-emerald-950/30">
              <CheckCircle2
                className="h-5 w-5 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
              <p className="text-sm text-foreground">
                Tout est prêt. Cet événement coche les 7 critères de santé.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {priorities.map((c) => {
                const action = COMPONENT_CTA[c.key];
                if (!action) return null;
                return (
                  <li key={c.key}>
                    <Link
                      href={action.href(eventId ?? "")}
                      className={cn(
                        "group flex items-center gap-3 rounded-md border border-border bg-background p-3 motion-safe:transition-colors hover:border-primary/40 hover:bg-accent/30",
                      )}
                    >
                      <AlertTriangle
                        className="h-4 w-4 text-amber-600 shrink-0"
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground">{c.label}</div>
                        <p className="text-xs text-muted-foreground truncate">{c.detail}</p>
                      </div>
                      <span className="text-xs font-medium text-primary shrink-0">
                        {action.ctaLabel}
                      </span>
                      <ArrowRight
                        className="h-4 w-4 text-muted-foreground shrink-0 motion-safe:transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
