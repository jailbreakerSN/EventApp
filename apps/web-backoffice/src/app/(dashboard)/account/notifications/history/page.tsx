"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  Button,
  Skeleton,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  QueryError,
} from "@teranga/shared-ui";
import { Mail, MailOpen, MailX, Inbox, RefreshCcw } from "lucide-react";
import {
  notificationsApi,
  type NotificationHistoryRow,
} from "@/lib/api-client";

// ─── Phase 2.5 — Per-user communication history ────────────────────────
// Renders the last 90 days of emails Teranga has sent to the current
// user. For each row we surface the subject, time, and a delivery-
// status badge (vert: delivered, jaune: sent, rouge: bounced /
// complained). If the row shows a user-opt-outable key and a
// user_opted_out reason, a resubscribe button appears so the user can
// flip the key back on without hunting through Paramètres.
//
// French-first — matches the rest of the backoffice. SSR-safe data
// fetching via @tanstack/react-query with a single-request pagination
// cursor; "Charger plus" appends another page into the list client-
// side so network hops stay bounded on 3G.

type HistoryPage = {
  success: boolean;
  data: NotificationHistoryRow[];
  meta: { limit: number; nextCursor: string | null };
};

function formatAttemptedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("fr-SN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function describeReason(reason: NotificationHistoryRow["reason"]): string | null {
  switch (reason) {
    case "admin_disabled":
      return "Désactivé par l'administrateur";
    case "user_opted_out":
      return "Vous vous êtes désabonné";
    case "on_suppression_list":
      return "Adresse sur liste de suppression";
    case "bounced":
      return "Adresse injoignable (rejet)";
    case "no_recipient":
      return "Aucun destinataire";
    default:
      return null;
  }
}

// ─── Status badge ──────────────────────────────────────────────────────

type Tone = "green" | "yellow" | "red" | "gray" | "blue";

const toneClasses: Record<Tone, string> = {
  green: "bg-green-100 text-green-800 border-green-200",
  yellow: "bg-amber-100 text-amber-800 border-amber-200",
  red: "bg-red-100 text-red-800 border-red-200",
  gray: "bg-gray-100 text-gray-700 border-gray-200",
  blue: "bg-blue-100 text-blue-800 border-blue-200",
};

function StatusBadge({ row }: { row: NotificationHistoryRow }) {
  // Priority: terminal failures (bounced/complained) win, then
  // delivery progress (delivered/opened/clicked), then the dispatch
  // status (sent/suppressed/deduplicated).
  if (row.deliveryStatus === "bounced" || row.deliveryStatus === "complained") {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${toneClasses.red}`}>
        <MailX className="h-3 w-3" aria-hidden="true" />
        {row.deliveryStatus === "bounced" ? "Rejeté" : "Signalé spam"}
      </span>
    );
  }
  if (row.status === "suppressed") {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${toneClasses.red}`}>
        <MailX className="h-3 w-3" aria-hidden="true" />
        Non envoyé
      </span>
    );
  }
  if (row.status === "deduplicated") {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${toneClasses.gray}`}>
        <Inbox className="h-3 w-3" aria-hidden="true" />
        Déjà envoyé
      </span>
    );
  }
  if (row.deliveryStatus === "opened" || row.deliveryStatus === "clicked") {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${toneClasses.blue}`}>
        <MailOpen className="h-3 w-3" aria-hidden="true" />
        {row.deliveryStatus === "clicked" ? "Lien cliqué" : "Ouvert"}
      </span>
    );
  }
  if (row.deliveryStatus === "delivered") {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${toneClasses.green}`}>
        <Mail className="h-3 w-3" aria-hidden="true" />
        Livré
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${toneClasses.yellow}`}>
      <Mail className="h-3 w-3" aria-hidden="true" />
      Envoyé
    </span>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────

export default function NotificationHistoryPage() {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<NotificationHistoryRow[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [exhausted, setExhausted] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<HistoryPage>({
    queryKey: ["notifications-history", cursor ?? "first"],
    queryFn: async () => {
      const res = await notificationsApi.history({ limit: 50, cursor });
      return res as HistoryPage;
    },
  });

  // Fold fetched pages into a single ordered list so the UI can show
  // everything loaded so far without re-requesting on scroll-up.
  useMemo(() => {
    if (!data?.data) return;
    setRows((prev) => {
      // Replace entirely on the first page; append for subsequent pages.
      if (!cursor) return data.data;
      const seen = new Set(prev.map((r) => r.id));
      return [...prev, ...data.data.filter((r) => !seen.has(r.id))];
    });
    if (!data.meta.nextCursor) setExhausted(true);
  }, [data, cursor]);

  const resubscribeMutation = useMutation({
    mutationFn: async (key: string) => notificationsApi.resubscribe(key),
    onSuccess: (_res, key) => {
      toast.success("Réabonnement confirmé", {
        description: `Vous recevrez à nouveau les e-mails pour « ${key} ».`,
      });
      // Invalidate so the next fetch picks up updated preferences.
      void queryClient.invalidateQueries({ queryKey: ["notifications-history"] });
    },
    onError: () => {
      toast.error("Impossible de se réabonner", {
        description: "Réessayez dans quelques instants.",
      });
    },
  });

  return (
    <div className="space-y-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/dashboard">Tableau de bord</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/settings">Paramètres</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Historique des notifications</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-teranga-navy">
            Historique des notifications
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Liste des e-mails envoyés à votre adresse sur les 90 derniers jours.
            Cliquez sur « Se réabonner » si vous souhaitez recevoir à nouveau
            une notification dont vous vous étiez désabonné.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Rafraîchir la liste"
        >
          <RefreshCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          Rafraîchir
        </Button>
      </div>

      {isError ? (
        <QueryError
          onRetry={() => refetch()}
          title="Historique indisponible"
          message={
            error instanceof Error
              ? error.message
              : "Nous n'arrivons pas à charger votre historique. Réessayez dans un instant."
          }
        />
      ) : null}

      <Card>
        <CardContent className="p-0">
          {isLoading && rows.length === 0 ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
              <Inbox className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">Aucun e-mail envoyé</p>
              <p className="max-w-md text-xs text-muted-foreground">
                Nous ne vous avons rien envoyé sur les 90 derniers jours. Cette
                page se remplira dès qu'un e-mail sera dispatché.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {rows.map((row) => {
                const reasonLabel = describeReason(row.reason);
                const showResubscribe =
                  row.userOptOutAllowed && row.reason === "user_opted_out";
                return (
                  <li
                    key={row.id}
                    className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge row={row} />
                        <span className="text-xs text-muted-foreground">
                          {formatAttemptedAt(row.attemptedAt)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-teranga-navy">
                        {row.subject}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Type : <span className="font-mono">{row.key}</span>
                      </p>
                      {reasonLabel ? (
                        <p className="mt-1 text-xs text-red-700">{reasonLabel}</p>
                      ) : null}
                    </div>
                    {showResubscribe ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => resubscribeMutation.mutate(row.key)}
                        disabled={resubscribeMutation.isPending}
                        aria-label={`Se réabonner aux notifications « ${row.key} »`}
                      >
                        Se réabonner
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && !exhausted ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => {
              const last = rows[rows.length - 1];
              if (last) setCursor(last.attemptedAt);
            }}
            disabled={isFetching}
          >
            {isFetching ? "Chargement…" : "Charger plus"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
