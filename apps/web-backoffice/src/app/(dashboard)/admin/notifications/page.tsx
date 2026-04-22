"use client";

/**
 * Phase 4 super-admin notification control-plane.
 *
 * Lists every notification in the catalog with its effective state (enabled,
 * channels, subject override) plus rolling sent/suppressed stats. The layout
 * (admin/layout.tsx) already gates access to super_admin; this page adds the
 * catalog fetch, the inline enable/disable switch (optimistic), and a
 * detail dialog for channel + subject-override edits.
 *
 * Backend contracts live in apps/api/src/routes/admin.routes.ts §"Notification
 * Control Plane". Every save round-trips through PUT /v1/admin/notifications/:key
 * which emits `notification.setting_updated` for the audit log — we don't
 * write to Firestore from the browser.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Bell, Edit3, Eye, History, ShieldCheck } from "lucide-react";
import { PreviewDialog } from "./preview-dialog";
import { HistoryPanel } from "./history-panel";
import {
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  InlineErrorBanner,
  Input,
  Select,
  SectionHeader,
  Skeleton,
  Switch,
  Tooltip,
} from "@teranga/shared-ui";
import type {
  I18nString,
  NotificationCategory,
  NotificationChannel,
  NotificationSuppressionReason,
} from "@teranga/shared-types";
import {
  adminNotificationsApi,
  type AdminNotificationRow,
  type AdminNotificationStatsEntry,
  type AdminNotificationStatsResponse,
  type AdminNotificationUpdateDto,
} from "@/lib/api-client";
import { useErrorHandler, type ResolvedError } from "@/hooks/use-error-handler";

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_CHANNELS: NotificationChannel[] = ["email", "sms", "push", "in_app"];

const WINDOW_OPTIONS: { value: number; labelKey: "days1" | "days7" | "days30" }[] = [
  { value: 1, labelKey: "days1" },
  { value: 7, labelKey: "days7" },
  { value: 30, labelKey: "days30" },
];

const CATEGORY_BADGE_VARIANT: Record<
  NotificationCategory,
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info"
  | "pending"
  | "neutral"
  | "premium"
> = {
  auth: "destructive",
  transactional: "info",
  organizational: "success",
  billing: "warning",
  marketing: "neutral",
};

const SUPPRESSION_THRESHOLD = 0.05;

// ─── Types ───────────────────────────────────────────────────────────────────

type StatsMap = Record<string, AdminNotificationStatsEntry>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function suppressionRate(entry: AdminNotificationStatsEntry | undefined): number {
  if (!entry) return 0;
  const total = entry.sent + entry.suppressed;
  if (total === 0) return 0;
  return entry.suppressed / total;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("fr-SN", { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AdminNotificationsPage() {
  const t = useTranslations("admin.notifications");
  const tErrors = useTranslations("errors");
  const tErrorActions = useTranslations("errors.actions");
  const { resolve } = useErrorHandler();

  const [rows, setRows] = useState<AdminNotificationRow[]>([]);
  const [stats, setStats] = useState<StatsMap>({});
  const [windowDays, setWindowDays] = useState<number>(7);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ResolvedError | null>(null);
  const [rowError, setRowError] = useState<ResolvedError | null>(null);
  const [editing, setEditing] = useState<AdminNotificationRow | null>(null);
  // Phase 2.4 — preview dialog + inline history panel. Preview is a
  // per-row dialog; history is an inline expansion (only one open at a
  // time) to keep the table scannable.
  const [previewing, setPreviewing] = useState<AdminNotificationRow | null>(null);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());

  // ── Initial load: catalog + stats in parallel ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const [catalogRes, statsRes] = await Promise.all([
          adminNotificationsApi.list(),
          adminNotificationsApi.stats(7),
        ]);
        if (cancelled) return;
        setRows(catalogRes.data);
        setStats(statsRes.data.stats);
      } catch (err) {
        if (cancelled) return;
        setLoadError(resolve(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [resolve]);

  // ── Stats-only refetch when the time window changes ───────────────────────
  const refetchStats = useCallback(
    async (days: number) => {
      try {
        const res: { data: AdminNotificationStatsResponse } =
          await adminNotificationsApi.stats(days);
        setStats(res.data.stats);
      } catch (err) {
        // Non-blocking — surface as a toast, keep existing stats on screen.
        resolve(err).toast();
      }
    },
    [resolve],
  );

  const handleWindowChange = (days: number) => {
    setWindowDays(days);
    void refetchStats(days);
  };

  // ── Optimistic enable/disable toggle ──────────────────────────────────────
  const handleToggle = async (row: AdminNotificationRow, nextEnabled: boolean) => {
    // Optimistic: flip immediately, revert on failure.
    setRows((prev) =>
      prev.map((r) => (r.key === row.key ? { ...r, enabled: nextEnabled, hasOverride: true } : r)),
    );
    setPendingKeys((prev) => new Set(prev).add(row.key));
    setRowError(null);

    const dto: AdminNotificationUpdateDto = {
      enabled: nextEnabled,
      channels: row.channels,
      ...(row.subjectOverride ? { subjectOverride: row.subjectOverride } : {}),
    };

    try {
      await adminNotificationsApi.update(row.key, dto);
      toast.success(nextEnabled ? t("toast.enabled") : t("toast.disabled"));
    } catch (err) {
      // Roll back.
      setRows((prev) =>
        prev.map((r) =>
          r.key === row.key ? { ...r, enabled: row.enabled, hasOverride: row.hasOverride } : r,
        ),
      );
      setRowError(resolve(err));
    } finally {
      setPendingKeys((prev) => {
        const next = new Set(prev);
        next.delete(row.key);
        return next;
      });
    }
  };

  // ── Drawer save: merges channel multi-select + subject override ───────────
  const handleDrawerSave = async (
    row: AdminNotificationRow,
    next: { channels: NotificationChannel[]; subjectOverride?: I18nString },
  ) => {
    const dto: AdminNotificationUpdateDto = {
      enabled: row.enabled,
      channels: next.channels,
      ...(next.subjectOverride ? { subjectOverride: next.subjectOverride } : {}),
    };

    setPendingKeys((prev) => new Set(prev).add(row.key));
    try {
      await adminNotificationsApi.update(row.key, dto);
      setRows((prev) =>
        prev.map((r) =>
          r.key === row.key
            ? {
                ...r,
                channels: next.channels,
                subjectOverride: next.subjectOverride,
                hasOverride: true,
                updatedAt: new Date().toISOString(),
              }
            : r,
        ),
      );
      toast.success(t("toast.saved"));
      setEditing(null);
    } catch (err) {
      setRowError(resolve(err));
    } finally {
      setPendingKeys((prev) => {
        const next = new Set(prev);
        next.delete(row.key);
        return next;
      });
    }
  };

  const sortedRows = useMemo(() => {
    // Keep catalog order stable — it's already grouped by category/dot-prefix
    // in shared-types. No need to mutate.
    return rows;
  }, [rows]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
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
              <Link href="/admin">{t("breadcrumbAdmin")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{t("breadcrumbCurrent")}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <SectionHeader
        kicker={t("kicker")}
        title={t("title")}
        subtitle={t("subtitle")}
        size="hero"
        as="h1"
      />

      {/* Mutation/toggle banner — blocking errors land here per the error-handling contract */}
      {rowError && (
        <InlineErrorBanner
          severity={rowError.severity}
          kicker={tErrors("kicker")}
          title={rowError.title}
          description={rowError.description}
          onDismiss={() => setRowError(null)}
          dismissLabel={tErrorActions("dismiss")}
        />
      )}

      {/* Stats window picker */}
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor="window-picker"
          className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
        >
          {t("window.label")}
        </label>
        <Select
          id="window-picker"
          value={String(windowDays)}
          onChange={(e) => handleWindowChange(Number(e.target.value))}
          aria-label={t("window.label")}
          className="max-w-xs"
        >
          {WINDOW_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(`window.${opt.labelKey}`)}
            </option>
          ))}
        </Select>
      </div>

      {/* Load-error state */}
      {loadError && !loading && (
        <InlineErrorBanner
          severity={loadError.severity}
          kicker={tErrors("kicker")}
          title={t("errorTitle")}
          description={t("errorDescription")}
        />
      )}

      {/* Table card */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <NotificationsSkeleton />
          ) : sortedRows.length === 0 ? (
            <div
              role="status"
              className="flex flex-col items-center gap-3 px-6 py-16 text-center text-muted-foreground"
            >
              <Bell className="h-10 w-10 opacity-30" aria-hidden="true" />
              <p>{t("empty")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label={t("title")}>
                <thead className="border-b border-border bg-muted/30">
                  <tr className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="px-4 py-3">
                      {t("table.key")}
                    </th>
                    <th scope="col" className="px-4 py-3">
                      {t("table.name")}
                    </th>
                    <th scope="col" className="px-4 py-3">
                      {t("table.channels")}
                    </th>
                    <th scope="col" className="px-4 py-3 text-center">
                      {t("table.enabled")}
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      {t("table.sent")}
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      {t("table.suppressed")}
                    </th>
                    <th scope="col" className="px-4 py-3 text-right">
                      {t("table.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <NotificationRow
                      key={row.key}
                      row={row}
                      stats={stats[row.key]}
                      pending={pendingKeys.has(row.key)}
                      onToggle={(next) => void handleToggle(row, next)}
                      onEdit={() => setEditing(row)}
                      onPreview={() => setPreviewing(row)}
                      onHistory={() =>
                        setHistoryKey((prev) => (prev === row.key ? null : row.key))
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {editing && (
        <EditNotificationDialog
          row={editing}
          saving={pendingKeys.has(editing.key)}
          onClose={() => setEditing(null)}
          onSave={(next) => void handleDrawerSave(editing, next)}
        />
      )}

      {/* Phase 2.4 — Preview + Test-send dialog. */}
      {previewing && (
        <PreviewDialog row={previewing} onClose={() => setPreviewing(null)} />
      )}

      {/* Phase 2.4 — Inline history panel (one open at a time). */}
      {historyKey && (
        <HistoryPanel
          notificationKey={historyKey}
          onClose={() => setHistoryKey(null)}
        />
      )}
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

interface NotificationRowProps {
  row: AdminNotificationRow;
  stats: AdminNotificationStatsEntry | undefined;
  pending: boolean;
  onToggle: (next: boolean) => void;
  onEdit: () => void;
  /** Phase 2.4 — opens the preview + test-send dialog. Optional so the
   *  component remains backward-compatible with callers that only wire
   *  the edit path. */
  onPreview?: () => void;
  /** Phase 2.4 — toggles the inline history panel below the row. */
  onHistory?: () => void;
}

function NotificationRow({
  row,
  stats,
  pending,
  onToggle,
  onEdit,
  onPreview,
  onHistory,
}: NotificationRowProps) {
  const t = useTranslations("admin.notifications");
  const rate = suppressionRate(stats);
  const highSuppression = rate > SUPPRESSION_THRESHOLD;

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/20 focus-within:bg-muted/30">
      <td className="px-4 py-3 align-top">
        <code className="font-mono text-[11px] text-foreground">{row.key}</code>
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-foreground">{row.displayName.fr}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={CATEGORY_BADGE_VARIANT[row.category]} className="text-[10px]">
              {t(`category.${row.category}`)}
            </Badge>
            {!row.userOptOutAllowed && (
              <Tooltip content={t("meta.mandatoryHint")} position="right">
                <Badge variant="destructive" className="text-[10px]">
                  <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" />
                  {t("table.mandatory")}
                </Badge>
              </Tooltip>
            )}
            {row.hasOverride ? (
              <span className="text-[10px] text-muted-foreground">
                {row.updatedAt
                  ? t("meta.lastUpdated", { date: formatDate(row.updatedAt) })
                  : t("table.overridden")}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground">{t("table.defaults")}</span>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex flex-wrap gap-1">
          {row.channels.map((ch) => (
            <Badge key={ch} variant="neutral" className="text-[10px]">
              {t(`channel.${ch}`)}
            </Badge>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 text-center align-top">
        <Switch
          checked={row.enabled}
          onCheckedChange={onToggle}
          disabled={pending || !row.userOptOutAllowed}
          label={`${t("table.enabled")} — ${row.displayName.fr}`}
        />
      </td>
      <td className="px-4 py-3 text-right align-top font-mono text-xs text-foreground">
        {stats ? stats.sent : <span className="text-muted-foreground">{t("meta.noStats")}</span>}
      </td>
      <td className="px-4 py-3 text-right align-top">
        <div className="inline-flex items-center gap-1.5">
          <span className="font-mono text-xs text-foreground">
            {stats ? stats.suppressed : <span className="text-muted-foreground">0</span>}
          </span>
          {highSuppression && stats && (
            <Tooltip content={buildSuppressionBreakdown(t, stats)} position="left">
              <span
                role="img"
                aria-label={t("suppression.warningLabel", { percent: Math.round(rate * 100) })}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-teranga-clay/15 text-teranga-clay-dark"
              >
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              </span>
            </Tooltip>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-right align-top">
        <div className="inline-flex items-center gap-1">
          {onPreview && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onPreview}
              aria-label={`Aperçu — ${row.displayName.fr}`}
            >
              <Eye className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Aperçu
            </Button>
          )}
          {onHistory && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onHistory}
              aria-label={`Historique — ${row.displayName.fr}`}
            >
              <History className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Historique
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onEdit}
            aria-label={`${t("table.edit")} — ${row.displayName.fr}`}
          >
            <Edit3 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t("table.edit")}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function buildSuppressionBreakdown(
  t: ReturnType<typeof useTranslations>,
  stats: AdminNotificationStatsEntry,
): string {
  const parts: string[] = [t("suppression.breakdownTitle")];
  const reasons: NotificationSuppressionReason[] = [
    "admin_disabled",
    "user_opted_out",
    "on_suppression_list",
    "bounced",
    "no_recipient",
  ];
  for (const reason of reasons) {
    const count = stats.suppressionByReason[reason];
    if (count && count > 0) {
      parts.push(`${t(`suppression.${reason}`)}: ${count}`);
    }
  }
  return parts.join(" · ");
}

// ─── Edit dialog ─────────────────────────────────────────────────────────────

interface EditNotificationDialogProps {
  row: AdminNotificationRow;
  saving: boolean;
  onClose: () => void;
  onSave: (next: { channels: NotificationChannel[]; subjectOverride?: I18nString }) => void;
}

function EditNotificationDialog({ row, saving, onClose, onSave }: EditNotificationDialogProps) {
  const t = useTranslations("admin.notifications");
  const [channels, setChannels] = useState<NotificationChannel[]>(row.channels);
  const [subjectFr, setSubjectFr] = useState(row.subjectOverride?.fr ?? "");
  const [subjectEn, setSubjectEn] = useState(row.subjectOverride?.en ?? "");
  const [subjectWo, setSubjectWo] = useState(row.subjectOverride?.wo ?? "");

  const emptyChannels = channels.length === 0;

  const toggleChannel = (ch: NotificationChannel) => {
    setChannels((prev) => (prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]));
  };

  const handleSubmit = () => {
    if (emptyChannels) return;
    // Only ship a subject override if all three locales are provided —
    // backend I18nStringSchema requires fr/en/wo present and non-empty.
    const allSubjects = subjectFr.trim() && subjectEn.trim() && subjectWo.trim();
    const subjectOverride: I18nString | undefined = allSubjects
      ? { fr: subjectFr.trim(), en: subjectEn.trim(), wo: subjectWo.trim() }
      : undefined;
    onSave({ channels, subjectOverride });
  };

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-xl" closeLabel={t("drawer.close")}>
        <DialogHeader>
          <DialogTitle>{t("drawer.title")}</DialogTitle>
          <DialogDescription>
            <code className="font-mono text-[11px]">{row.key}</code>
            <span className="mx-2">·</span>
            {row.displayName.fr}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-5">
          {/* Channels */}
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-foreground">
              {t("drawer.channelsLabel")}
            </legend>
            <p className="mb-3 text-xs text-muted-foreground">{t("drawer.channelsHelp")}</p>
            <div className="space-y-2">
              {ALL_CHANNELS.map((ch) => {
                const supported = row.supportedChannels.includes(ch);
                if (!supported) return null;
                return (
                  <label
                    key={ch}
                    className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={channels.includes(ch)}
                      onChange={() => toggleChannel(ch)}
                      className="h-4 w-4 rounded border-input"
                      aria-label={t(`channel.${ch}`)}
                    />
                    <span>{t(`channel.${ch}`)}</span>
                  </label>
                );
              })}
            </div>
            {emptyChannels && (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {t("drawer.channelsEmptyError")}
              </p>
            )}
          </fieldset>

          {/* Subject override — optional, all 3 locales or none */}
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-foreground">
              {t("drawer.subjectLabel")}
            </legend>
            <p className="mb-3 text-xs text-muted-foreground">{t("drawer.subjectHelp")}</p>
            <div className="space-y-2">
              <div>
                <label htmlFor="subject-fr" className="mb-1 block text-xs text-muted-foreground">
                  {t("drawer.subjectFr")}
                </label>
                <Input
                  id="subject-fr"
                  value={subjectFr}
                  onChange={(e) => setSubjectFr(e.target.value)}
                  placeholder={row.displayName.fr}
                />
              </div>
              <div>
                <label htmlFor="subject-en" className="mb-1 block text-xs text-muted-foreground">
                  {t("drawer.subjectEn")}
                </label>
                <Input
                  id="subject-en"
                  value={subjectEn}
                  onChange={(e) => setSubjectEn(e.target.value)}
                  placeholder={row.displayName.en}
                />
              </div>
              <div>
                <label htmlFor="subject-wo" className="mb-1 block text-xs text-muted-foreground">
                  {t("drawer.subjectWo")}
                </label>
                <Input
                  id="subject-wo"
                  value={subjectWo}
                  onChange={(e) => setSubjectWo(e.target.value)}
                  placeholder={row.displayName.wo}
                />
              </div>
            </div>
          </fieldset>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("drawer.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={saving || emptyChannels}>
            {saving ? t("drawer.saving") : t("drawer.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function NotificationsSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-busy="true" aria-live="polite">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-lg border border-border p-3">
          <Skeleton variant="text" className="h-4 w-40" />
          <Skeleton variant="text" className="h-4 w-56" />
          <Skeleton variant="text" className="h-4 w-24" />
          <Skeleton variant="rectangle" className="ml-auto h-6 w-11 rounded-full" />
        </div>
      ))}
    </div>
  );
}
