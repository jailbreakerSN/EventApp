"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { notificationsApi } from "@/lib/api-client";
import type { Notification } from "@teranga/shared-types";
import {
  Bell,
  UserPlus,
  CreditCard,
  MessageCircle,
  Calendar,
  CheckCheck,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  Button,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  QueryError,
} from "@teranga/shared-ui";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getNotificationIcon(type: Notification["type"]) {
  switch (type) {
    case "registration_confirmed":
    case "registration_approved":
      return <UserPlus className="h-5 w-5 text-blue-600" />;
    case "new_message":
    case "new_announcement":
      return <MessageCircle className="h-5 w-5 text-purple-600" />;
    case "event_reminder":
    case "event_published":
    case "event_cancelled":
    case "event_updated":
      return <Calendar className="h-5 w-5 text-amber-600" />;
    case "check_in_success":
      return <CheckCheck className="h-5 w-5 text-green-600" />;
    case "badge_ready":
      return <CreditCard className="h-5 w-5 text-emerald-600" />;
    default:
      return <Bell className="h-5 w-5 text-muted-foreground" />;
  }
}

function getNotificationIconBg(type: Notification["type"]) {
  switch (type) {
    case "registration_confirmed":
    case "registration_approved":
      return "bg-blue-100";
    case "new_message":
    case "new_announcement":
      return "bg-purple-100";
    case "event_reminder":
    case "event_published":
    case "event_cancelled":
    case "event_updated":
      return "bg-amber-100";
    case "check_in_success":
      return "bg-green-100";
    case "badge_ready":
      return "bg-emerald-100";
    default:
      return "bg-muted";
  }
}

function formatRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 1) return "A l'instant";
  if (diffMinutes < 60) return `Il y a ${diffMinutes} min`;
  if (diffHours < 24) return `Il y a ${diffHours}h`;
  if (diffDays === 1) return "Hier";
  if (diffDays < 7) return `Il y a ${diffDays} jours`;
  return date.toLocaleDateString("fr-SN", {
    day: "numeric",
    month: "short",
  });
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const t = useTranslations("nav");
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");
  const limit = 20;

  // Fetch notifications
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["notifications", page, filter],
    queryFn: () =>
      notificationsApi.list({
        page,
        limit,
        unreadOnly: filter === "unread" ? true : undefined,
      }),
  });

  const notifications = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  // Filter read notifications client-side when "read" tab selected
  const filteredNotifications =
    filter === "read" ? notifications.filter((n) => n.isRead) : notifications;

  // Mark single as read
  const markAsRead = useMutation({
    mutationFn: (notificationId: string) => notificationsApi.markAsRead(notificationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  // Mark all as read
  const markAllAsRead = useMutation({
    mutationFn: () => notificationsApi.markAllAsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Toutes les notifications marquées comme lues");
    },
    onError: () => {
      toast.error("Erreur lors de la mise à jour");
    },
  });

  const handleNotificationClick = useCallback(
    (notification: Notification) => {
      if (!notification.isRead) {
        markAsRead.mutate(notification.id);
      }
    },
    [markAsRead],
  );

  const hasUnread = notifications.some((n) => !n.isRead);
  const hasMore = notifications.length >= limit;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("notifications")}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {total > 0
              ? `${total} notification${total > 1 ? "s" : ""}`
              : "Vos notifications apparaitront ici"}
          </p>
        </div>

        {hasUnread && (
          <Button
            variant="outline"
            onClick={() => markAllAsRead.mutate()}
            disabled={markAllAsRead.isPending}
          >
            {markAllAsRead.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <CheckCheck className="h-4 w-4 mr-2" />
            )}
            Tout marquer comme lu
          </Button>
        )}
      </div>

      {/* Filter tabs */}
      <Tabs
        defaultValue="all"
        value={filter}
        onValueChange={(v) => {
          setFilter(v as "all" | "unread" | "read");
          setPage(1);
        }}
      >
        <TabsList>
          <TabsTrigger value="all">Toutes</TabsTrigger>
          <TabsTrigger value="unread">Non lues</TabsTrigger>
          <TabsTrigger value="read">Lues</TabsTrigger>
        </TabsList>

        {/* Content for all tabs is the same filtered list */}
        <TabsContent value={filter} className="mt-4">
          {/* Loading state */}
          {isLoading && (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4 flex items-start gap-3">
                    <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Error state */}
          {isError && !isLoading && <QueryError onRetry={refetch} />}

          {/* Empty state */}
          {!isLoading && !isError && filteredNotifications.length === 0 && (
            <Card>
              <CardContent className="p-10 text-center">
                <Bell className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground mb-1">Aucune notification</p>
                <p className="text-xs text-muted-foreground">
                  {filter === "unread"
                    ? "Vous avez lu toutes vos notifications."
                    : filter === "read"
                      ? "Aucune notification lue pour le moment."
                      : "Vous n'avez pas encore de notifications. Elles apparaitront ici lorsque vous en recevrez."}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Notification list */}
          {!isLoading && !isError && filteredNotifications.length > 0 && (
            <div className="space-y-2">
              {filteredNotifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => handleNotificationClick(notification)}
                  className={`w-full text-left rounded-xl border transition-colors ${
                    notification.isRead
                      ? "bg-card border-border hover:bg-accent/50"
                      : "bg-primary/5 border-primary/20 hover:bg-primary/10"
                  }`}
                >
                  <div className="p-4 flex items-start gap-3">
                    {/* Icon */}
                    <div
                      className={`rounded-full p-2 flex-shrink-0 ${getNotificationIconBg(
                        notification.type,
                      )}`}
                    >
                      {getNotificationIcon(notification.type)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p
                          className={`text-sm ${
                            notification.isRead
                              ? "text-foreground"
                              : "text-foreground font-semibold"
                          }`}
                        >
                          {notification.title}
                        </p>
                        {!notification.isRead && (
                          <span className="mt-1.5 h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {notification.body}
                      </p>
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        {formatRelativeTime(notification.createdAt)}
                      </p>
                    </div>
                  </div>
                </button>
              ))}

              {/* Load more */}
              {hasMore && (
                <div className="pt-4 text-center">
                  <Button variant="outline" onClick={() => setPage((p) => p + 1)}>
                    Charger plus
                  </Button>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
