"use client";

import { parseAsBoolean } from "nuqs";
import { AlertTriangle, Bell, CheckCheck, Circle, RotateCcw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useNotifications, useMarkAsRead, useMarkAllAsRead } from "@/hooks/use-notifications";
import { useTableState } from "@/hooks/use-table-state";
import { intlLocale } from "@/lib/intl-locale";
import { Button, EmptyStateEditorial, SectionHeader } from "@teranga/shared-ui";
import type { Notification } from "@teranga/shared-types";

const PAGE_SIZE = 20;

export default function NotificationsPage() {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const regional = intlLocale(locale);

  // W5 stream archetype migration — useTableState owns URL state for the
  // unreadOnly toggle + page index. Stream contract: chronological is
  // forced (sortableFields: []), no user-chosen sort offered.
  // shallow:true (default) is correct here — the page is a Client
  // Component that fetches via React Query, the queryKey reacts to URL
  // changes automatically.
  const ts = useTableState<{ unreadOnly?: boolean }>({
    urlNamespace: "notifs",
    defaults: { sort: null, pageSize: 25 },
    sortableFields: [],
    filterParsers: { unreadOnly: parseAsBoolean },
  });

  const unreadOnly = !!ts.filters.unreadOnly;
  const { data, isLoading, isError, refetch } = useNotifications({
    page: ts.page,
    limit: PAGE_SIZE,
    unreadOnly,
  });
  const notifications = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      <SectionHeader
        kicker="— ALERTES"
        title={t("title")}
        subtitle={t("count", { count: total })}
        size="hero"
        as="h1"
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => ts.setFilter("unreadOnly", unreadOnly ? undefined : true)}
              aria-pressed={unreadOnly}
            >
              {unreadOnly ? t("filterAll") : t("filterUnread")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllAsRead.mutate()}
              disabled={markAllAsRead.isPending}
            >
              <CheckCheck className="mr-1 h-4 w-4" />
              {t("markAllRead")}
            </Button>
          </div>
        }
      />

      {isError ? (
        <EmptyStateEditorial
          icon={AlertTriangle}
          kicker="— ERREUR"
          title={t("errorTitle")}
          description={t("errorDescription")}
          action={
            <Button variant="outline" onClick={() => refetch()}>
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
              {t("retry")}
            </Button>
          }
        />
      ) : isLoading ? (
        <div className="space-y-2" role="status" aria-label={t("title")}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="animate-pulse rounded-lg border p-4">
              <div className="flex items-start gap-3">
                <div className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-muted"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-1/2"></div>
                  <div className="h-3 bg-muted rounded w-3/4"></div>
                  <div className="h-3 bg-muted rounded w-24"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <EmptyStateEditorial
          icon={Bell}
          kicker="— AUCUNE NOTIFICATION"
          title={unreadOnly ? t("emptyUnread") : t("empty")}
          action={
            unreadOnly ? (
              <Button variant="outline" onClick={() => ts.reset()}>
                {t("filterAll")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2">
          {notifications.map((n: Notification) => (
            <button
              key={n.id}
              onClick={() => {
                if (!n.isRead) markAsRead.mutate(n.id);
              }}
              className={`w-full rounded-lg border p-4 text-left transition-colors ${
                n.isRead
                  ? "bg-card"
                  : "border-teranga-gold/30 bg-teranga-gold/5 dark:border-teranga-gold/40 dark:bg-teranga-gold/15"
              }`}
            >
              <div className="flex items-start gap-3">
                {!n.isRead && (
                  <Circle className="mt-1 h-2.5 w-2.5 flex-shrink-0 fill-teranga-gold text-teranga-gold" />
                )}
                <div className="flex-1">
                  <p className="font-medium">{n.title}</p>
                  <p className="text-sm text-muted-foreground">{n.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(n.createdAt).toLocaleDateString(regional, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <nav
          aria-label="Pagination des notifications"
          className="mt-6 flex items-center justify-center gap-3"
        >
          <Button
            variant="outline"
            size="sm"
            disabled={ts.page <= 1}
            onClick={() => ts.setPage(Math.max(1, ts.page - 1))}
            aria-label={t("paginationPrev")}
          >
            {t("paginationPrev")}
          </Button>
          <span className="text-sm text-muted-foreground" aria-current="page">
            {t("paginationOf", { page: ts.page, total: totalPages })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={ts.page >= totalPages}
            onClick={() => ts.setPage(ts.page + 1)}
            aria-label={t("paginationNext")}
          >
            {t("paginationNext")}
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
