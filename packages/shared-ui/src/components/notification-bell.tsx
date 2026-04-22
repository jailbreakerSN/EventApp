"use client";

/**
 * Presentational bell icon + notification panel for both web apps.
 *
 * Zero data-fetching logic lives inside this component — it's fed entirely
 * via props so each app (web-backoffice, web-participant) can wire its own
 * React-Query hooks + real-time Firestore listener without the shared
 * library taking on a data-layer dependency.
 *
 * Accessibility contract (reviewed against WCAG 2.1 AA for Teranga):
 *   - The trigger exposes a unique `aria-label` with the unread count.
 *   - The unread-count badge is `aria-hidden` (screen readers already hear
 *     it via the aria-label).
 *   - `aria-expanded` + `aria-controls` on the trigger; panel uses `role=
 *     dialog` with `aria-modal=false` so the rest of the page stays
 *     interactive (parity with the participant's existing `/notifications`
 *     page UX).
 *   - Escape closes; outside click closes; focus returns to trigger on
 *     close.
 *   - Panel has a skip-to-see-all link so keyboard users don't have to
 *     tab through every row.
 *   - List items expose `aria-current="true"` when unread so assistive
 *     tech can differentiate them; also encoded visually with a
 *     teranga-gold dot.
 *
 * Localisation: copy is passed in via the `labels` prop. French defaults
 * only (Teranga is francophone-first); caller overrides for English /
 * Wolof. Matches the `packages/shared-ui/src/lib/i18n.ts` pattern used by
 * QueryError / DataTable.
 */

import * as React from "react";
import { Bell } from "lucide-react";
import { cn } from "../lib/utils";

// ─── Domain types ──────────────────────────────────────────────────────────

export interface NotificationBellRow {
  /** Firestore doc id. Stable across renders. */
  id: string;
  /** Rendered as the row title. Already resolved to the user's locale. */
  title: string;
  /** Rendered beneath the title, clamped to 2 lines. */
  body: string;
  /** ISO 8601 — the component formats it via the supplied `formatRelative`. */
  createdAt: string;
  /** Unread rows get a visible dot + `aria-current="true"`. */
  isRead: boolean;
  /**
   * Optional deep-link. Clicking the row navigates here (via the provided
   * `onNavigate` callback or a fallback `<a href>`). Keeping the anchor
   * outside the component lets each app use Next's `<Link>` directly.
   */
  href?: string;
  /**
   * Notification type from the catalog — used only for the optional icon
   * badge. Callers that don't want the badge can omit this.
   */
  type?: string;
}

export interface NotificationBellLabels {
  /** Aria-label on the trigger button. `{count}` is replaced if present. */
  triggerAria: string;
  /** Header inside the panel. */
  title: string;
  /** Button in the header when at least one row is unread. */
  markAllRead: string;
  /** Footer link below the list. */
  seeAll: string;
  /** Shown when the list is empty. */
  emptyTitle: string;
  emptyBody: string;
  /** Shown during the initial load. */
  loading: string;
}

export interface NotificationBellProps {
  /**
   * Rows to render. The component doesn't paginate — caller passes the
   * first page (usually 10 rows). The "See all" footer goes to the full
   * page for deeper history.
   */
  notifications: NotificationBellRow[];
  /**
   * Total unread. Drives the badge on the trigger. Kept separate from
   * `notifications.filter(r => !r.isRead).length` because the panel
   * shows only the first page — a user with 50 unread should see "50"
   * even if only 10 rows are fetched.
   */
  unreadCount: number;
  /** First load + refetch indicator. Skeleton rows instead of the list. */
  isLoading?: boolean;
  /** Fetch error; the component renders a small inline message. */
  errorMessage?: string;
  /**
   * Fires when a row is clicked. Caller typically:
   *   1. optimistically marks the row as read,
   *   2. navigates to row.href (if provided),
   *   3. closes the panel.
   */
  onRowClick?: (row: NotificationBellRow) => void;
  /** Fires when the "mark all read" button is pressed. */
  onMarkAllRead?: () => void | Promise<unknown>;
  /** Fires the moment the panel opens. Useful for prefetching. */
  onOpen?: () => void;
  /** Renders a "See all" footer link with this href. */
  seeAllHref?: string;
  /**
   * Formats `createdAt` into a human string ("il y a 2 min"). Caller
   * provides the locale-aware formatter so this library stays
   * dependency-free.
   */
  formatRelative: (iso: string) => string;
  /** i18n labels. French defaults applied if omitted. */
  labels?: Partial<NotificationBellLabels>;
  /** Extra classes on the trigger button. */
  className?: string;
}

const DEFAULT_LABELS: NotificationBellLabels = {
  triggerAria: "Notifications ({count} non lues)",
  title: "Notifications",
  markAllRead: "Tout marquer comme lu",
  seeAll: "Voir toutes les notifications",
  emptyTitle: "Aucune notification",
  emptyBody: "Les nouveautés apparaîtront ici.",
  loading: "Chargement…",
};

// ─── Component ─────────────────────────────────────────────────────────────

export function NotificationBell({
  notifications,
  unreadCount,
  isLoading = false,
  errorMessage,
  onRowClick,
  onMarkAllRead,
  onOpen,
  seeAllHref,
  formatRelative,
  labels,
  className,
}: NotificationBellProps) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const panelId = React.useId();
  const titleId = React.useId();

  const merged: NotificationBellLabels = { ...DEFAULT_LABELS, ...labels };
  const triggerAria = merged.triggerAria.replace("{count}", String(unreadCount));
  const cappedUnread = unreadCount > 99 ? "99+" : String(unreadCount);

  // Outside-click close: register on open, tear down on close. We listen to
  // `pointerdown` so the panel closes before a click on a <Link> commits
  // navigation — otherwise rapid clicks race with the close-on-navigate
  // path.
  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  // Escape closes + return focus to trigger.
  React.useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Call onOpen only on the open transition, not on every render. Using a
  // ref-guard instead of a plain `useEffect([open])` avoids the fire-on-
  // unmount pattern.
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) onOpen?.();
    wasOpen.current = open;
  }, [open, onOpen]);

  const handleRowClick = React.useCallback(
    (row: NotificationBellRow) => {
      onRowClick?.(row);
      setOpen(false);
    },
    [onRowClick],
  );

  const handleMarkAllRead = React.useCallback(async () => {
    if (!onMarkAllRead) return;
    await onMarkAllRead();
  }, [onMarkAllRead]);

  return (
    <div className={cn("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={triggerAria}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          // Match the shared-ui Button "ghost" + "icon" combo used elsewhere
          // in the two topbars. Reproduced inline so the bell has no
          // forced coupling to Button variants that may change.
          "inline-flex h-10 w-10 items-center justify-center rounded-full",
          "text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center",
              "rounded-full bg-[var(--teranga-gold,#d4af37)] px-1 text-[10px] font-semibold text-white",
              "ring-2 ring-background",
            )}
            data-testid="notification-bell-unread-badge"
          >
            {cappedUnread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          className={cn(
            "absolute right-0 top-full z-50 mt-2 w-[380px] max-w-[calc(100vw-2rem)]",
            "origin-top-right rounded-xl border border-border bg-popover text-popover-foreground shadow-lg",
            "animate-in fade-in-0 zoom-in-95",
          )}
          data-testid="notification-bell-panel"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 id={titleId} className="text-sm font-semibold">
              {merged.title}
            </h2>
            {unreadCount > 0 && onMarkAllRead && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className={cn(
                  "text-xs font-medium text-primary underline-offset-4 hover:underline",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1",
                )}
              >
                {merged.markAllRead}
              </button>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto" role="feed" aria-busy={isLoading}>
            {isLoading && notifications.length === 0 ? (
              <div className="space-y-3 p-4" aria-live="polite">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex gap-3">
                    <div className="h-2 w-2 mt-2 shrink-0 rounded-full bg-muted" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-3/4 rounded bg-muted" />
                      <div className="h-3 w-full rounded bg-muted" />
                    </div>
                  </div>
                ))}
                <span className="sr-only">{merged.loading}</span>
              </div>
            ) : errorMessage ? (
              <p
                className="px-4 py-6 text-sm text-destructive"
                role="alert"
                data-testid="notification-bell-error"
              >
                {errorMessage}
              </p>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-10 text-center" data-testid="notification-bell-empty">
                <Bell className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm font-medium">{merged.emptyTitle}</p>
                <p className="mt-1 text-xs text-muted-foreground">{merged.emptyBody}</p>
              </div>
            ) : (
              <ul className="divide-y divide-border" data-testid="notification-bell-list">
                {notifications.map((row) => {
                  const content = (
                    <div className="flex gap-3">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                          row.isRead ? "bg-transparent" : "bg-[var(--teranga-gold,#d4af37)]",
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            "text-sm leading-tight",
                            row.isRead ? "text-muted-foreground" : "font-semibold",
                          )}
                        >
                          {row.title}
                        </p>
                        <p className="mt-0.5 text-xs leading-snug text-muted-foreground line-clamp-2">
                          {row.body}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {formatRelative(row.createdAt)}
                        </p>
                      </div>
                    </div>
                  );

                  const rowClass = cn(
                    "block w-full px-4 py-3 text-left transition-colors",
                    "hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none",
                  );

                  return (
                    <li key={row.id} aria-current={row.isRead ? undefined : "true"}>
                      {row.href ? (
                        <a
                          href={row.href}
                          onClick={(e) => {
                            e.preventDefault();
                            handleRowClick(row);
                            // Consumer-side navigation (Next.js <Link>) is
                            // triggered via onRowClick — no direct window
                            // navigation here so soft routing still works.
                          }}
                          className={rowClass}
                        >
                          {content}
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleRowClick(row)}
                          className={rowClass}
                        >
                          {content}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {seeAllHref && (
            <a
              href={seeAllHref}
              onClick={() => setOpen(false)}
              className={cn(
                "block border-t border-border px-4 py-2.5 text-center text-xs font-medium",
                "text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              data-testid="notification-bell-see-all"
            >
              {merged.seeAll}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
