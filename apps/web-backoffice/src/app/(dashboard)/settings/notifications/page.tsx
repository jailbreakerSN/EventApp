"use client";

/**
 * Phase 3 — Per-key notification preferences.
 * Fetches /v1/notifications/catalog once, lets the user toggle any key
 * where userOptOutAllowed === true, batches diffs in `pendingByKey`, then
 * PUTs /v1/notifications/preferences on save. One fetch + one save keeps
 * the page usable on 3G. Mandatory keys render disabled with a tooltip;
 * the dispatcher ignores per-key opt-out for them anyway (see
 * docs/notification-system-architecture.md §8).
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useTranslations, useLocale } from "next-intl";
import { Bell, Save, Loader2, Lock } from "lucide-react";
import {
  Card,
  CardContent,
  Button,
  Switch,
  Skeleton,
  Tooltip,
  InlineErrorBanner,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@teranga/shared-ui";
import { notificationsApi, type NotificationCatalogEntry } from "@/lib/api-client";
import { useErrorHandler, type ResolvedError } from "@/hooks/use-error-handler";
import type { NotificationCategory } from "@teranga/shared-types";

// Matches docs/notification-system-architecture.md §7 ordering.
const CATEGORY_ORDER: NotificationCategory[] = [
  "auth",
  "transactional",
  "billing",
  "organizational",
  "marketing",
];

type CatalogLocale = "fr" | "en" | "wo";
const pickLocale = (locale: string): CatalogLocale =>
  locale === "en" || locale === "wo" ? locale : "fr";

// ─── NotificationToggle ────────────────────────────────────────────────────

function NotificationToggle({
  entry,
  effectiveEnabled,
  onToggle,
  locale,
  mandatoryTooltip,
  mandatorySrHint,
}: {
  entry: NotificationCatalogEntry;
  effectiveEnabled: boolean;
  onToggle: (next: boolean) => void;
  locale: CatalogLocale;
  mandatoryTooltip: string;
  mandatorySrHint: string;
}) {
  const disabled = !entry.userOptOutAllowed;
  const label = entry.displayName[locale];
  const description = entry.description[locale];
  const switchId = `notif-${entry.key.replace(/\./g, "-")}`;

  const switchNode = (
    <Switch
      id={switchId}
      checked={effectiveEnabled}
      onCheckedChange={onToggle}
      disabled={disabled}
      aria-label={label}
      aria-describedby={`${switchId}-desc`}
    />
  );

  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0 flex-1">
        <label
          htmlFor={switchId}
          className={`text-sm font-medium text-foreground ${disabled ? "opacity-70" : "cursor-pointer"}`}
        >
          {label}
          {disabled && (
            <Lock className="ml-1.5 inline h-3 w-3 text-muted-foreground" aria-hidden="true" />
          )}
        </label>
        <p id={`${switchId}-desc`} className="mt-0.5 text-xs text-muted-foreground">
          {description}
        </p>
        {disabled && <span className="sr-only">{mandatorySrHint}</span>}
      </div>
      <div className="flex-shrink-0">
        {disabled ? (
          <Tooltip content={mandatoryTooltip} position="left">
            {switchNode}
          </Tooltip>
        ) : (
          switchNode
        )}
      </div>
    </div>
  );
}

// ─── CategorySection ───────────────────────────────────────────────────────

function CategorySection({
  entries,
  effectiveByKey,
  onToggle,
  locale,
  heading,
  description,
  mandatoryTooltip,
  mandatorySrHint,
  headingId,
  topSlot,
}: {
  entries: NotificationCatalogEntry[];
  effectiveByKey: Record<string, boolean>;
  onToggle: (key: string, next: boolean) => void;
  locale: CatalogLocale;
  heading: string;
  description: string;
  mandatoryTooltip: string;
  mandatorySrHint: string;
  headingId: string;
  topSlot?: React.ReactNode;
}) {
  if (entries.length === 0) return null;
  return (
    <Card>
      <CardContent className="p-6">
        <h2
          id={headingId}
          className="text-base font-semibold text-foreground flex items-center gap-2"
        >
          <Bell className="h-4 w-4 text-teranga-gold" aria-hidden="true" />
          {heading}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        {topSlot && <div className="mt-4">{topSlot}</div>}
        <div className="mt-4 divide-y divide-border">
          {entries.map((entry) => (
            <NotificationToggle
              key={entry.key}
              entry={entry}
              effectiveEnabled={effectiveByKey[entry.key] ?? entry.enabled}
              onToggle={(next) => onToggle(entry.key, next)}
              locale={locale}
              mandatoryTooltip={mandatoryTooltip}
              mandatorySrHint={mandatorySrHint}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function NotificationPreferencesPage() {
  const t = useTranslations("notifications.preferences");
  const tCategories = useTranslations("notifications.preferences.categories");
  const tErrors = useTranslations("errors");
  const tErrorActions = useTranslations("errors.actions");
  const locale = pickLocale(useLocale());
  const { resolve: resolveError } = useErrorHandler();

  const [catalog, setCatalog] = useState<NotificationCatalogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ResolvedError | null>(null);
  const [saveError, setSaveError] = useState<ResolvedError | null>(null);
  const [saving, setSaving] = useState(false);
  // pendingByKey holds only the keys the user flipped this session. Empty
  // map = no unsaved changes. Kept distinct from the catalog's `enabled`
  // field so we can show an accurate diff count and revert cleanly.
  const [pendingByKey, setPendingByKey] = useState<Record<string, boolean>>({});

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await notificationsApi.catalog();
      setCatalog(response.data);
      setPendingByKey({});
    } catch (err) {
      setLoadError(resolveError(err));
    } finally {
      setLoading(false);
    }
  }, [resolveError]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const effectiveByKey = useMemo(() => {
    const map: Record<string, boolean> = {};
    if (catalog) for (const entry of catalog) map[entry.key] = entry.enabled;
    return { ...map, ...pendingByKey };
  }, [catalog, pendingByKey]);

  const grouped = useMemo(() => {
    const groups: Record<NotificationCategory, NotificationCatalogEntry[]> = {
      auth: [],
      transactional: [],
      organizational: [],
      billing: [],
      marketing: [],
    };
    if (catalog) for (const entry of catalog) groups[entry.category].push(entry);
    return groups;
  }, [catalog]);

  const handleToggle = useCallback(
    (key: string, next: boolean) => {
      if (!catalog) return;
      const original = catalog.find((e) => e.key === key)?.enabled ?? true;
      setPendingByKey((prev) => {
        const copy = { ...prev };
        // When the user flips back to the server value, clear the pending
        // entry so the unsaved-count stays truthful and the CTA hides.
        if (next === original) delete copy[key];
        else copy[key] = next;
        return copy;
      });
    },
    [catalog],
  );

  const handlePauseAllMarketing = useCallback(
    (next: boolean) => {
      if (!catalog) return;
      setPendingByKey((prev) => {
        const copy = { ...prev };
        for (const entry of grouped.marketing) {
          if (!entry.userOptOutAllowed) continue;
          if (next === entry.enabled) delete copy[entry.key];
          else copy[entry.key] = next;
        }
        return copy;
      });
    },
    [catalog, grouped.marketing],
  );

  const handleCancel = useCallback(() => {
    setPendingByKey({});
    setSaveError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (Object.keys(pendingByKey).length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Merge pending over the current server state so we PUT the full
      // picture — avoids races where another tab flipped a key we didn't.
      const byKey: Record<string, boolean> = {};
      if (catalog) for (const entry of catalog) byKey[entry.key] = entry.enabled;
      for (const [key, value] of Object.entries(pendingByKey)) byKey[key] = value;
      await notificationsApi.updatePreferences({ byKey });

      // Locally merge pending so the next diff baseline is correct
      // without a refetch round-trip.
      if (catalog) {
        setCatalog(
          catalog.map((entry) =>
            entry.key in pendingByKey ? { ...entry, enabled: pendingByKey[entry.key]! } : entry,
          ),
        );
      }
      setPendingByKey({});
      toast.success(t("saveSuccess"));
    } catch (err) {
      setSaveError(resolveError(err));
    } finally {
      setSaving(false);
    }
  }, [catalog, pendingByKey, resolveError, t]);

  const marketingToggleable = grouped.marketing.filter((e) => e.userOptOutAllowed);
  const allMarketingEnabled =
    marketingToggleable.length > 0 &&
    marketingToggleable.every((e) => effectiveByKey[e.key] ?? e.enabled);

  const pendingCount = Object.keys(pendingByKey).length;
  const hasUnsaved = pendingCount > 0;

  return (
    <div className="max-w-3xl space-y-6">
      <Breadcrumb className="mb-2">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/">{t("breadcrumbHome")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/settings">{t("breadcrumbSettings")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{t("breadcrumbCurrent")}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {loading && (
        <div aria-label={t("loadingAria")} aria-busy="true" className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-6 space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-64" />
                <div className="mt-4 space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!loading && loadError && (
        <InlineErrorBanner
          severity={loadError.severity}
          kicker={tErrors("kicker")}
          title={t("errorLoadingTitle")}
          description={t("errorLoadingDescription")}
          actions={[{ label: t("retry"), onClick: () => void loadCatalog() }]}
        />
      )}

      {!loading && !loadError && catalog && catalog.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-sm font-medium text-foreground">{t("empty")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("emptyDescription")}</p>
          </CardContent>
        </Card>
      )}

      {!loading && !loadError && saveError && (
        <InlineErrorBanner
          severity={saveError.severity}
          kicker={tErrors("kicker")}
          title={saveError.title}
          description={saveError.description}
          onDismiss={() => setSaveError(null)}
          dismissLabel={tErrorActions("dismiss")}
        />
      )}

      {!loading &&
        !loadError &&
        catalog &&
        catalog.length > 0 &&
        CATEGORY_ORDER.map((category) => {
          const entries = grouped[category];
          if (entries.length === 0) return null;
          const isMarketing = category === "marketing";
          return (
            <CategorySection
              key={category}
              entries={entries}
              effectiveByKey={effectiveByKey}
              onToggle={handleToggle}
              locale={locale}
              heading={tCategories(category)}
              description={tCategories(`${category}Description`)}
              mandatoryTooltip={t("mandatoryTooltip")}
              mandatorySrHint={t("mandatorySrHint")}
              headingId={`notif-cat-${category}`}
              topSlot={
                isMarketing && marketingToggleable.length > 0 ? (
                  <div className="rounded-lg border border-teranga-gold/30 bg-teranga-gold/5 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">
                          {t("pauseAllMarketing")}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t("pauseAllMarketingDescription")}
                        </p>
                      </div>
                      <Switch
                        checked={allMarketingEnabled}
                        onCheckedChange={handlePauseAllMarketing}
                        aria-label={t("pauseAllMarketing")}
                      />
                    </div>
                  </div>
                ) : null
              }
            />
          );
        })}

      {hasUnsaved && (
        <div
          className="sticky bottom-4 z-10 flex flex-col gap-2 rounded-card border bg-background/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between"
          role="status"
          aria-live="polite"
        >
          <p className="text-sm text-muted-foreground">
            <span className="sr-only">{t("unsavedAnnounce")}: </span>
            {t("unsavedCount", { count: pendingCount })}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleCancel} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  {t("saving")}
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t("save")}
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
