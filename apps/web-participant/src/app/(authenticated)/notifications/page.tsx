"use client";

import { useState } from "react";
import { AlertTriangle, Bell, CheckCheck, Circle, RotateCcw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useNotifications, useMarkAsRead, useMarkAllAsRead } from "@/hooks/use-notifications";
import {
  Button,
  EmptyStateEditorial,
  SectionHeader,
} from "@teranga/shared-ui";
import type { Notification } from "@teranga/shared-types";

function intlLocale(locale: string): string {
  switch (locale) {
    case "fr":
      return "fr-SN";
    case "en":
      return "en-SN";
    case "wo":
      return "wo-SN";
    default:
      return locale;
  }
}

export default function NotificationsPage() {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const regional = intlLocale(locale);
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const { data, isLoading, isError, refetch } = useNotifications({ page, limit: 20, unreadOnly });
  const notifications = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

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
            <Button variant="outline" size="sm" onClick={() => setUnreadOnly(!unreadOnly)}>
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
        <div className="space-y-2">
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

      {total > 20 && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t("paginationPrev")}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t("paginationOf", { page, total: Math.ceil(total / 20) })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page * 20 >= total}
            onClick={() => setPage(page + 1)}
          >
            {t("paginationNext")}
          </Button>
        </div>
      )}
    </div>
  );
}
