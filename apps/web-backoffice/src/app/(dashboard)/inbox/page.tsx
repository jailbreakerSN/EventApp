"use client";

/**
 * Organizer overhaul — Phase O2.
 *
 * Task-oriented landing for the organizer shell. Replaces the
 * `/dashboard` metric panel as the post-login default — operators
 * arrive on a list of "what needs me today?" rather than a vanity
 * KPI dashboard. Mirror of the admin inbox at `/admin/inbox`.
 *
 * Layout:
 *   - Hero: title + last-update timestamp + manual refresh button.
 *   - 6 sections (Urgent / Aujourd'hui / Cette semaine / Croissance /
 *     Modération / Équipe) — each empty section is hidden so the
 *     page never grows long with empty headers.
 *   - Inside each section: cards sorted by severity (critical →
 *     warning → info), each card a deep-link to the pre-filtered
 *     destination.
 *   - Empty state: a "Tout va bien" success card when the inbox
 *     resolves with zero signals.
 *
 * Auto-refresh + backoff lives in `useOrganizerInbox()`.
 */

import Link from "next/link";
import { useMemo } from "react";
import { Card, CardContent, SectionHeader, Skeleton } from "@teranga/shared-ui";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Info,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useOrganizerInbox,
  ORGANIZER_INBOX_REFRESH_MS,
  type OrganizerInboxSignal,
  type OrganizerSignalCategory,
  type OrganizerSignalSeverity,
} from "@/hooks/use-organizer-inbox";

const CATEGORY_ORDER: readonly OrganizerSignalCategory[] = [
  "urgent",
  "today",
  "week",
  "growth",
  "moderation",
  "team",
];

const CATEGORY_LABEL: Record<OrganizerSignalCategory, string> = {
  urgent: "Urgent",
  today: "Aujourd'hui",
  week: "Cette semaine",
  growth: "Croissance",
  moderation: "Modération",
  team: "Équipe",
};

const CATEGORY_DESCRIPTION: Record<OrganizerSignalCategory, string> = {
  urgent: "À traiter immédiatement — risque de perte de revenu ou de confiance.",
  today: "Ce qui se passe aujourd'hui — événements en cours, publications prévues.",
  week: "À planifier cette semaine — campagnes, paiements en attente, drafts à publier.",
  growth: "Limites de plan, opportunités d'upgrade, levier produit.",
  moderation: "Speakers, sponsors, messages à valider.",
  team: "Invitations, rôles, gouvernance interne.",
};

const SEVERITY_RANK: Record<OrganizerSignalSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const SEVERITY_STYLES: Record<
  OrganizerSignalSeverity,
  { border: string; bg: string; iconColor: string; icon: typeof AlertTriangle }
> = {
  critical: {
    border: "border-red-200 dark:border-red-900/50",
    bg: "bg-red-50/50 dark:bg-red-950/20",
    iconColor: "text-red-600 dark:text-red-400",
    icon: ShieldAlert,
  },
  warning: {
    border: "border-amber-200 dark:border-amber-900/50",
    bg: "bg-amber-50/50 dark:bg-amber-950/20",
    iconColor: "text-amber-600 dark:text-amber-400",
    icon: AlertTriangle,
  },
  info: {
    border: "border-sky-200 dark:border-sky-900/50",
    bg: "bg-sky-50/50 dark:bg-sky-950/20",
    iconColor: "text-sky-600 dark:text-sky-400",
    icon: Info,
  },
};

export default function OrganizerInboxPage() {
  const { signals, error, lastUpdate, refreshing, refetch } = useOrganizerInbox();

  // The "Event of the day" hero is the live-now signal hoisted out of
  // the regular grid for visual prominence — when an event is happening
  // RIGHT NOW, the operator should see it before anything else.
  const eventOfTheDay = useMemo(
    () => (signals ? (signals.find((s) => s.id === "events.live_now") ?? null) : null),
    [signals],
  );

  // Group by category, ordered per CATEGORY_ORDER, with severity sort
  // inside each group. Empty sections are dropped so the page never
  // grows long with placeholder headers. The eventOfTheDay signal is
  // filtered out so it doesn't double-render in the "today" section.
  const groupedSignals = useMemo(() => {
    if (!signals) return null;
    const buckets = new Map<OrganizerSignalCategory, OrganizerInboxSignal[]>();
    for (const sig of signals) {
      if (sig.id === "events.live_now") continue;
      const list = buckets.get(sig.category) ?? [];
      list.push(sig);
      buckets.set(sig.category, list);
    }
    return CATEGORY_ORDER.flatMap((cat) => {
      const items = buckets.get(cat);
      if (!items || items.length === 0) return [];
      const sorted = [...items].sort(
        (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
      );
      return [{ category: cat, items: sorted }];
    });
  }, [signals]);

  const loading = signals === null && !error;
  const isEmpty = groupedSignals !== null && groupedSignals.length === 0 && eventOfTheDay === null;

  return (
    <div className="container mx-auto max-w-6xl space-y-6">
      <SectionHeader
        kicker="— Ma boîte"
        title="Vos actions du jour"
        subtitle="Ce qui demande votre attention sur vos événements et votre organisation."
        action={
          lastUpdate ? (
            <button
              type="button"
              onClick={refetch}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Rafraîchir les signaux"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
                aria-hidden="true"
              />
              {refreshing ? "Rafraîchissement..." : "Rafraîchir"}
            </button>
          ) : undefined
        }
      />

      {error && (
        <Card className="border-red-200 dark:border-red-900/50">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 text-red-600" aria-hidden="true" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-foreground">
                Impossible de charger la boîte
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{error}</div>
            </div>
            <button
              type="button"
              onClick={refetch}
              className="text-xs font-medium text-teranga-gold hover:underline"
            >
              Réessayer
            </button>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton variant="text" className="h-4 w-24" />
                <Skeleton variant="text" className="mt-2 h-5 w-full" />
                <Skeleton variant="text" className="mt-1 h-3 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Event-of-the-day hero — hoisted from `today` when an event is live. */}
      {eventOfTheDay && <EventOfTheDayHero signal={eventOfTheDay} />}

      {isEmpty && (
        <Card className="border-teranga-green/30 bg-teranga-green/5">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-teranga-green" aria-hidden="true" />
            <div className="text-lg font-semibold text-foreground">Tout va bien</div>
            <p className="max-w-md text-sm text-muted-foreground">
              Aucune action prioritaire n'est ouverte. Vous pouvez parcourir vos événements ou
              utiliser{" "}
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
                ⌘K
              </kbd>{" "}
              pour la recherche rapide.
            </p>
          </CardContent>
        </Card>
      )}

      {groupedSignals && groupedSignals.length > 0 && (
        <div className="space-y-8">
          {groupedSignals.map(({ category, items }) => (
            <section key={category} aria-labelledby={`section-${category}`}>
              <header className="mb-3">
                <h2
                  id={`section-${category}`}
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {CATEGORY_LABEL[category]}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground/80">
                  {CATEGORY_DESCRIPTION[category]}
                </p>
              </header>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((signal) => (
                  <InboxCard key={signal.id} signal={signal} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {lastUpdate && (
        <div className="text-right text-[10px] text-muted-foreground">
          Dernière mise à jour : {new Date(lastUpdate).toLocaleTimeString("fr-SN")} ·
          Rafraîchissement auto toutes les {ORGANIZER_INBOX_REFRESH_MS / 1000}s
        </div>
      )}
    </div>
  );
}

function EventOfTheDayHero({ signal }: { signal: OrganizerInboxSignal }) {
  // Visually distinct from the regular signal grid: full-width band,
  // emerald accent (live = on-going), pulsing dot, prominent CTA. The
  // href stays whatever the API returned (today: events list filtered
  // by live=true). Phase O8 will replace this href with `/events/[id]/live`
  // when the Live Event Mode surface lands.
  return (
    <Link
      href={signal.href}
      className="group block rounded-lg border border-emerald-300 bg-emerald-50/60 p-5 transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-emerald-700 dark:bg-emerald-950/30"
      aria-label={`${signal.title} — Événement(s) en cours aujourd'hui. Cliquer pour ouvrir la liste live.`}
    >
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/50">
          <CircleDot
            className="h-6 w-6 animate-pulse text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
        </div>
        <div className="flex-1">
          <div className="mb-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            En direct · Aujourd'hui
          </div>
          <div className="text-base font-semibold text-foreground">{signal.title}</div>
          <p className="mt-1 text-xs text-muted-foreground">{signal.description}</p>
        </div>
        <div className="hidden sm:flex flex-col items-end justify-center gap-1 text-right">
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
            Ouvrir la vue live
          </span>
          <ArrowRight
            className="h-4 w-4 text-emerald-600 transition-transform group-hover:translate-x-0.5 dark:text-emerald-400"
            aria-hidden="true"
          />
        </div>
      </div>
    </Link>
  );
}

function InboxCard({ signal }: { signal: OrganizerInboxSignal }) {
  const style = SEVERITY_STYLES[signal.severity];
  const Icon = style.icon;
  return (
    <Link
      href={signal.href}
      className={cn(
        "group block rounded-lg border p-4 transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teranga-gold",
        style.border,
        style.bg,
      )}
      aria-label={`${signal.title} — ${CATEGORY_LABEL[signal.category]}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {CATEGORY_LABEL[signal.category]}
        </span>
        <Icon className={cn("h-4 w-4", style.iconColor)} aria-hidden="true" />
      </div>
      <div className="mb-1 text-sm font-semibold text-foreground">{signal.title}</div>
      <div className="mb-3 text-xs text-muted-foreground">{signal.description}</div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-teranga-gold">Voir</span>
        <ArrowRight
          className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-teranga-gold"
          aria-hidden="true"
        />
      </div>
    </Link>
  );
}
