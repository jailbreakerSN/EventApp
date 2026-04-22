"use client";

/**
 * Phase 3 — Per-key notification preferences (participant).
 * Mirrors the backoffice page with the participant's editorial header and
 * a back-link instead of a full breadcrumb. Single GET on mount, single
 * PUT on save. Mandatory keys are rendered disabled with a tooltip; the
 * dispatcher ignores per-key opt-out for them (see
 * docs/notification-system-architecture.md §8).
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { Save, Loader2, Lock, ArrowLeft, Bell } from "lucide-react";
import {
  Card,
  CardContent,
  Button,
  Switch,
  Skeleton,
  Tooltip,
  InlineErrorBanner,
  SectionHeader,
} from "@teranga/shared-ui";
import { notificationsApi, type NotificationCatalogEntry } from "@/lib/api-client";
import { useErrorHandler, type ResolvedError } from "@/hooks/use-error-handler";
import type { NotificationCategory } from "@teranga/shared-types";

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

// ─── NotificationToggle ───────────────────────────────────────────────────

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

// ─── CategorySection ──────────────────────────────────────────────────────

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
      <CardContent className="space-y-3 py-6">
        <h2
          id={headingId}
          className="font-serif-display flex items-center gap-2 text-[20px] font-semibold tracking-[-0.015em]"
        >
          <Bell className="h-5 w-5 text-teranga-gold" aria-hidden="true" />
          {heading}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
        {topSlot}
        <div className="divide-y divide-border">
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

// ─── Main Component ───────────────────────────────────────────────────────

export default function ParticipantNotificationPreferencesPage() {
  const t = useTranslations("settings.notifications.preferences");
  const tCategories = useTranslations("settings.notifications.preferences.categories");
  const tErrors = useTranslations("errors");
  const tErrorActions = useTranslations("errors.actions");
  const locale = pickLocale(useLocale());
  const { resolve: resolveError } = useErrorHandler();

  const [catalog, setCatalog] = useState<NotificationCatalogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ResolvedError | null>(null);
  const [saveError, setSaveError] = useState<ResolvedError | null>(null);
  const [saveInfo, setSaveInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
    setSaveInfo(null);
    try {
      const byKey: Record<string, boolean> = {};
      if (catalog) for (const entry of catalog) byKey[entry.key] = entry.enabled;
      for (const [key, value] of Object.entries(pendingByKey)) byKey[key] = value;
      await notificationsApi.updatePreferences({ byKey });
      if (catalog) {
        setCatalog(
          catalog.map((entry) =>
            entry.key in pendingByKey ? { ...entry, enabled: pendingByKey[entry.key]! } : entry,
          ),
        );
      }
      setPendingByKey({});
      // Inline success banner (matches InlineErrorBanner's info severity).
      // Single visual spot for post-save feedback — users don't have to
      // look at two places (toast + page) to confirm it worked.
      setSaveInfo(t("saveSuccess"));
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
    <div className="mx-auto max-w-lg px-4 py-8 space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teranga-gold focus-visible:ring-offset-2 rounded"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("backToSettings")}
      </Link>

      <SectionHeader
        kicker={t("kicker")}
        title={t("title")}
        subtitle={t("subtitle")}
        size="hero"
        as="h1"
      />

      {loading && (
        <div aria-label={t("loadingAria")} aria-busy="true" className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="space-y-3 py-6">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-64" />
                <div className="space-y-3 pt-2">
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
          <CardContent className="py-6 text-center">
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

      {!loading && !loadError && saveInfo && (
        <InlineErrorBanner
          severity="info"
          title={saveInfo}
          onDismiss={() => setSaveInfo(null)}
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
