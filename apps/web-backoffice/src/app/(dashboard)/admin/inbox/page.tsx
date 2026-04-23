"use client";

/**
 * Phase 2 — Admin inbox (task-oriented landing).
 *
 * Fetches /v1/admin/inbox once on mount + auto-refresh every 60s. Groups
 * signals by category (Modération, Comptes, Billing, Ops, Events live) and
 * renders each as an <InboxCard> with a CTA that deep-links to the
 * pre-filtered list. When the API returns zero signals, we show a
 * "Tout va bien" success state instead of an anxiety-inducing empty page.
 *
 * Auto-refresh: setInterval with visibility-aware pause (skip when tab
 * hidden) so we don't burn Cloud Run credits on a backgrounded tab.
 * Signal: critical > warning > info — cards render in that priority order.
 */

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Card,
  CardContent,
  SectionHeader,
  Skeleton,
} from "@teranga/shared-ui";
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  ShieldAlert,
  RefreshCw,
  Info,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

type SignalSeverity = "critical" | "warning" | "info";
type SignalCategory = "moderation" | "accounts" | "billing" | "ops" | "events_live";

interface InboxSignal {
  id: string;
  category: SignalCategory;
  severity: SignalSeverity;
  title: string;
  description: string;
  count: number;
  href: string;
}

interface InboxResponse {
  success: boolean;
  data: {
    signals: InboxSignal[];
    computedAt: string;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 60_000;

const CATEGORY_LABEL: Record<SignalCategory, string> = {
  moderation: "Modération",
  accounts: "Comptes",
  billing: "Billing",
  ops: "Ops",
  events_live: "Événements en direct",
};

const SEVERITY_RANK: Record<SignalSeverity, number> = { critical: 0, warning: 1, info: 2 };

const SEVERITY_STYLES: Record<
  SignalSeverity,
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

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminInboxPage() {
  const [signals, setSignals] = useState<InboxSignal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSignals = useCallback(async () => {
    try {
      setRefreshing(true);
      const res = await api.get<InboxResponse>("/v1/admin/inbox");
      setSignals(res.data.signals);
      setLastUpdate(res.data.computedAt);
      setError(null);
    } catch (err) {
      setError((err as Error)?.message ?? "Erreur inconnue");
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Initial fetch + visibility-aware auto-refresh.
  useEffect(() => {
    void fetchSignals();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetchSignals();
      }
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchSignals]);

  // Sort by severity then keep natural server order within the same tier.
  const sortedSignals = signals
    ? [...signals].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    : null;

  const loading = signals === null && !error;

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Administration</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Ma boîte</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <SectionHeader
        kicker="— Administration"
        title="Ma boîte admin"
        subtitle="Ce qui demande votre attention aujourd'hui sur la plateforme"
        action={
          lastUpdate ? (
            <button
              type="button"
              onClick={() => void fetchSignals()}
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
              onClick={() => void fetchSignals()}
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

      {sortedSignals && sortedSignals.length === 0 && (
        <Card className="border-teranga-green/30 bg-teranga-green/5">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-teranga-green" aria-hidden="true" />
            <div className="text-lg font-semibold text-foreground">Tout va bien</div>
            <p className="max-w-md text-sm text-muted-foreground">
              Aucun signal critique n'est actif sur la plateforme. Bon travail ! Vous pouvez
              parcourir les listes via la barre latérale ou l'assistant{" "}
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
                ⌘K
              </kbd>
              .
            </p>
          </CardContent>
        </Card>
      )}

      {sortedSignals && sortedSignals.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sortedSignals.map((signal) => (
            <InboxCard key={signal.id} signal={signal} />
          ))}
        </div>
      )}

      {lastUpdate && (
        <div className="text-right text-[10px] text-muted-foreground">
          Dernière mise à jour : {new Date(lastUpdate).toLocaleTimeString("fr-FR")} ·
          Rafraîchissement auto toutes les {REFRESH_INTERVAL_MS / 1000}s
        </div>
      )}
    </div>
  );
}

// ─── Inbox card ──────────────────────────────────────────────────────────────

function InboxCard({ signal }: { signal: InboxSignal }) {
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
