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
import { Card, CardContent, Skeleton } from "@teranga/shared-ui";
import { CheckCircle2, ArrowRight, AlertTriangle } from "lucide-react";
import { EventHealthCard } from "@/components/event-health/EventHealthCard";
import { useEventHealth } from "@/hooks/use-event-health";
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

  // Priority actions = un-earned components, sorted by weight DESC
  // (impact-first). Capped at 5 so the panel stays scannable.
  const priorities = snapshot
    ? snapshot.components
        .filter((c) => c.earned < c.max)
        .sort((a, b) => b.max - a.max)
        .slice(0, 5)
    : [];

  return (
    <div className="space-y-6">
      <EventHealthCard eventId={eventId} />

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
