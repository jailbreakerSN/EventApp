"use client";

/**
 * Phase B.2 — Participant notification preferences.
 *
 * Route: /account/notifications/preferences
 *
 * Mirrors the backoffice prefs page but with next-intl strings across
 * fr / en / wo and the participant's editorial chrome (SectionHeader,
 * back-link). Consumes the Phase B.1 per-channel catalog:
 *   GET  /v1/notifications/catalog       → per-entry supportedChannels,
 *                                          defaultChannels, effectiveChannels,
 *                                          userPreference
 *   GET  /v1/notifications/preferences   → flat prefs doc (quiet hours,
 *                                          email category toggles, byKey)
 *   PUT  /v1/notifications/preferences   → same shape. byKey values accept
 *                                          boolean OR per-channel object.
 *   POST /v1/notifications/test-send     → self-targeted preview. Rate
 *                                          limited 5/h; rejects mandatory
 *                                          keys with 400 NOT_OPTABLE.
 *
 * Save-as-you-go: every switch fires a PUT with only the delta. Optimistic
 * cache updates via React Query's `invalidateQueries` on success and
 * rollback on error. Designed for low-bandwidth — one round-trip per
 * flip is fine because each payload is <100 bytes and the UI stays
 * responsive.
 *
 * Legacy byKey coercion: when the stored value for a key is a bare
 * boolean (pre-Phase-2.6 docs), we expand it into a per-channel object
 * on the first edit so the UI and the server share the same mental
 * model for that key going forward.
 *
 * Mandatory keys (auth + billing categories) render locked Switches +
 * "Obligatoire" badge + disabled Test button. The server rejects any
 * byKey write for those keys, so the UI is just a guardrail.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft, Bell, Clock, Info, Loader2, Lock, Send } from "lucide-react";
import {
  Card,
  CardContent,
  Button,
  Switch,
  Skeleton,
  Tooltip,
  InlineErrorBanner,
  Badge,
  SectionHeader,
} from "@teranga/shared-ui";
import {
  useNotificationCatalog,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  useTestSendSelf,
} from "@/hooks/use-notifications";
import { useWebPushRegistration } from "@/hooks/use-web-push-registration";
import { PushPermissionBanner } from "@/components/push-permission-banner";
import { useErrorHandler } from "@/hooks/use-error-handler";
import { type NotificationCatalogEntry } from "@/lib/api-client";
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationPreference,
  NotificationPreferenceValue,
  UpdateNotificationPreferenceDto,
} from "@teranga/shared-types";

// ─── Constants ────────────────────────────────────────────────────────────
const CATEGORY_ORDER: readonly NotificationCategory[] = [
  "auth",
  "transactional",
  "billing",
  "organizational",
  "marketing",
];

const CHANNEL_ORDER: readonly NotificationChannel[] = ["email", "in_app", "push", "sms"];

type CatalogLocale = "fr" | "en" | "wo";
const pickLocale = (locale: string): CatalogLocale =>
  locale === "en" || locale === "wo" ? locale : "fr";

function pickDisplay(entry: NotificationCatalogEntry, locale: CatalogLocale): string {
  return entry.displayName[locale] ?? entry.displayName.fr ?? entry.key;
}
function pickDescription(entry: NotificationCatalogEntry, locale: CatalogLocale): string {
  return entry.description[locale] ?? entry.description.fr ?? "";
}

// ─── Per-channel preference coercion ──────────────────────────────────────
// See the backoffice counterpart for the rationale. Kept duplicated here
// because the participant app doesn't share a components folder with
// backoffice — pulling it into shared-ui for two call sites isn't worth
// the cross-package coupling yet.
function expandLegacyValue(
  value: NotificationPreferenceValue | null | undefined,
  supportedChannels: readonly NotificationChannel[],
): Partial<Record<NotificationChannel, boolean>> {
  if (value && typeof value === "object") {
    return { ...(value as Partial<Record<NotificationChannel, boolean>>) };
  }
  const fill = value === false ? false : true;
  const next: Partial<Record<NotificationChannel, boolean>> = {};
  for (const ch of supportedChannels) next[ch] = fill;
  return next;
}

// ─── Page ─────────────────────────────────────────────────────────────────
export default function ParticipantPreferencesPage() {
  const t = useTranslations("notifications.prefs");
  const tCategories = useTranslations("notifications.prefs.categories");
  const tEmailCategories = useTranslations("notifications.prefs.emailCategories");
  const tChannel = useTranslations("notifications.prefs.channel");
  const tErrors = useTranslations("errors");
  const tErrorActions = useTranslations("errors.actions");
  const locale = pickLocale(useLocale());
  const { resolve: resolveError } = useErrorHandler();

  const catalogQuery = useNotificationCatalog();
  const prefsQuery = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();
  const testSend = useTestSendSelf();
  // Phase C integration — same rationale as the backoffice preferences
  // page: the per-row push Switch stays visible but goes uninteractive
  // until the user grants browser permission + successfully registers
  // an FCM token. A tooltip on the disabled Switch points users at the
  // PushPermissionBanner mounted a few DOM nodes up.
  const push = useWebPushRegistration();
  const pushDisabled = push.permission !== "granted" || !push.registeredFingerprint;

  const catalog = catalogQuery.data?.data ?? null;
  const prefs: NotificationPreference | null = prefsQuery.data?.data ?? null;

  const loading = catalogQuery.isLoading || prefsQuery.isLoading;
  const loadError = catalogQuery.error ?? prefsQuery.error;
  const saveError = updatePrefs.error ? resolveError(updatePrefs.error) : null;

  // Ephemeral banners for successful save + test-send. Kept as page-level
  // state (not toast) so screen readers get a single predictable
  // announcement surface — the `aria-live` region on InlineErrorBanner
  // with severity="info" is already wired for this pattern.
  const [saveInfo, setSaveInfo] = useState<string | null>(null);
  const [testSendInfo, setTestSendInfo] = useState<string | null>(null);
  const [testSendError, setTestSendError] = useState<string | null>(null);
  const [lastTestedKey, setLastTestedKey] = useState<string | null>(null);

  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Dakar";
    } catch {
      return "Africa/Dakar";
    }
  }, []);

  // ─── Save-as-you-go helper ─────────────────────────────────────────────
  const applyPatch = useCallback(
    (patch: UpdateNotificationPreferenceDto) => {
      setSaveInfo(null);
      updatePrefs.mutate(patch, {
        onSuccess: () => {
          setSaveInfo(t("saveSuccess"));
        },
      });
    },
    [updatePrefs, t],
  );

  const handleQuietHoursChange = useCallback(
    (field: "quietHoursStart" | "quietHoursEnd", value: string) => {
      applyPatch({ [field]: value || null });
    },
    [applyPatch],
  );

  const handleEmailCategoryToggle = useCallback(
    (field: "emailTransactional" | "emailOrganizational" | "emailMarketing", next: boolean) => {
      applyPatch({ [field]: next });
    },
    [applyPatch],
  );

  const handleChannelToggle = useCallback(
    (entry: NotificationCatalogEntry, channel: NotificationChannel, next: boolean) => {
      if (!entry.userOptOutAllowed) return;
      const currentValue: NotificationPreferenceValue | null =
        prefs?.byKey?.[entry.key] ?? entry.userPreference ?? null;
      const expanded = expandLegacyValue(currentValue, entry.supportedChannels);
      expanded[channel] = next;
      applyPatch({ byKey: { [entry.key]: expanded } });
    },
    [applyPatch, prefs],
  );

  const handleTestSend = useCallback(
    (entry: NotificationCatalogEntry) => {
      if (!entry.userOptOutAllowed) return;
      setTestSendInfo(null);
      setTestSendError(null);
      setLastTestedKey(entry.key);
      testSend.mutate(entry.key, {
        onSuccess: () => {
          setTestSendInfo(t("testSendSuccess"));
        },
        onError: (err: unknown) => {
          // Inspect the ApiError shape. `code` comes from the server's
          // error envelope; `status` is the HTTP code. Either reliably
          // differentiates the three meaningful outcomes: rate-limit,
          // mandatory-key rejection, and the generic failure bucket.
          const e = err as { status?: number; code?: string } | null;
          if (e?.status === 429 || e?.code === "RATE_LIMITED") {
            setTestSendError(t("testSendRateLimited"));
          } else if (e?.code === "NOT_OPTABLE") {
            setTestSendError(t("testSendNotOptable"));
          } else {
            setTestSendError(t("testSendError"));
          }
        },
      });
    },
    [testSend, t],
  );

  // ─── Grouping by category ──────────────────────────────────────────────
  const grouped = useMemo(() => {
    const groups: Record<NotificationCategory, NotificationCatalogEntry[]> = {
      auth: [],
      transactional: [],
      billing: [],
      organizational: [],
      marketing: [],
    };
    if (catalog) for (const entry of catalog) groups[entry.category].push(entry);
    return groups;
  }, [catalog]);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teranga-gold focus-visible:ring-offset-2"
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

      {/* ─── Push permission banner ────────────────────────────────────── */}
      {/* Phase B/C integration: self-hides when permission is granted,
          denied with no recovery path, or the user has dismissed ≥ 3×. */}
      <PushPermissionBanner trigger="settings-page" />

      {/* ─── Loading state ───────────────────────────────────────────────── */}
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
          severity="destructive"
          kicker={tErrors("kicker")}
          title={t("errorLoadingTitle")}
          description={t("errorLoadingDescription")}
          actions={[
            {
              label: t("retry"),
              onClick: () => {
                void catalogQuery.refetch();
                void prefsQuery.refetch();
              },
            },
          ]}
        />
      )}

      {/* ─── Ephemeral info + error banners (save / test-send) ──────────── */}
      {!loading && !loadError && saveError && (
        <InlineErrorBanner
          severity={saveError.severity}
          kicker={tErrors("kicker")}
          title={saveError.title}
          description={saveError.description}
          onDismiss={() => updatePrefs.reset()}
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
      {!loading && !loadError && testSendInfo && (
        <InlineErrorBanner
          severity="info"
          title={testSendInfo}
          onDismiss={() => setTestSendInfo(null)}
          dismissLabel={tErrorActions("dismiss")}
        />
      )}
      {!loading && !loadError && testSendError && (
        <InlineErrorBanner
          severity="warning"
          title={testSendError}
          onDismiss={() => setTestSendError(null)}
          dismissLabel={tErrorActions("dismiss")}
        />
      )}

      {!loading && !loadError && catalog && prefs && (
        <>
          {/* ─── Section 1: Quiet hours ─────────────────────────────── */}
          <Card>
            <CardContent className="space-y-4 py-6">
              <div>
                <h2 className="font-serif-display flex items-center gap-2 text-[20px] font-semibold tracking-[-0.015em]">
                  <Clock className="h-5 w-5 text-teranga-gold" aria-hidden="true" />
                  {t("quietHoursHeading")}
                  <Tooltip content={t("quietHoursTooltip")} position="top">
                    <Info
                      className="h-3.5 w-3.5 text-muted-foreground"
                      aria-label={t("quietHoursTooltip")}
                    />
                  </Tooltip>
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("quietHoursDescription")}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-foreground">
                    {t("quietHoursStart")}
                  </span>
                  <input
                    type="time"
                    value={prefs.quietHoursStart ?? ""}
                    onChange={(e) => handleQuietHoursChange("quietHoursStart", e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teranga-gold"
                    aria-label={t("quietHoursStart")}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-foreground">{t("quietHoursEnd")}</span>
                  <input
                    type="time"
                    value={prefs.quietHoursEnd ?? ""}
                    onChange={(e) => handleQuietHoursChange("quietHoursEnd", e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teranga-gold"
                    aria-label={t("quietHoursEnd")}
                  />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("quietHoursTimezoneNote", { timezone })}
              </p>
            </CardContent>
          </Card>

          {/* ─── Section 2: Email-category coarse toggles ──────────── */}
          <Card>
            <CardContent className="space-y-3 py-6">
              <h2 className="font-serif-display flex items-center gap-2 text-[20px] font-semibold tracking-[-0.015em]">
                <Bell className="h-5 w-5 text-teranga-gold" aria-hidden="true" />
                {t("categoriesHeading")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("categoriesDescription")}</p>
              <div className="divide-y divide-border">
                <EmailCategoryRow
                  label={tEmailCategories("transactional")}
                  description={tEmailCategories("transactionalDescription")}
                  checked={prefs.emailTransactional ?? true}
                  onChange={(v) => handleEmailCategoryToggle("emailTransactional", v)}
                />
                <EmailCategoryRow
                  label={tEmailCategories("organizational")}
                  description={tEmailCategories("organizationalDescription")}
                  checked={prefs.emailOrganizational ?? true}
                  onChange={(v) => handleEmailCategoryToggle("emailOrganizational", v)}
                />
                <EmailCategoryRow
                  label={tEmailCategories("marketing")}
                  description={tEmailCategories("marketingDescription")}
                  checked={prefs.emailMarketing ?? true}
                  onChange={(v) => handleEmailCategoryToggle("emailMarketing", v)}
                />
              </div>
            </CardContent>
          </Card>

          {/* ─── Section 3: Per-key, per-channel grid ──────────────── */}
          <Card>
            <CardContent className="space-y-3 py-6">
              <h2 className="font-serif-display flex items-center gap-2 text-[20px] font-semibold tracking-[-0.015em]">
                <Bell className="h-5 w-5 text-teranga-gold" aria-hidden="true" />
                {t("perKeyHeading")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("perKeyDescription")}</p>
            </CardContent>
          </Card>

          {CATEGORY_ORDER.map((category) => {
            const entries = grouped[category];
            if (entries.length === 0) return null;
            return (
              <Card key={category}>
                <CardContent className="space-y-3 py-6">
                  <h3 className="text-base font-semibold text-foreground">
                    {tCategories(category)}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {tCategories(`${category}Description` as `${typeof category}Description`)}
                  </p>
                  <div className="divide-y divide-border">
                    {entries.map((entry) => (
                      <PerKeyRow
                        key={entry.key}
                        entry={entry}
                        prefs={prefs}
                        locale={locale}
                        onChannelToggle={handleChannelToggle}
                        onTestSend={handleTestSend}
                        isTestSending={
                          testSend.isPending && lastTestedKey === entry.key
                        }
                        labels={{
                          mandatoryBadge: t("mandatoryBadge"),
                          mandatoryTooltip: t("mandatoryTooltip"),
                          mandatorySrHint: t("mandatorySrHint"),
                          testSend: t("testSend"),
                          testSendSending: t("testSendSending"),
                          testSendAria: (name: string) => t("testSendAria", { name }),
                          testSendMandatoryTooltip: t("testSendMandatoryTooltip"),
                          channelLabel: (ch: NotificationChannel) => tChannel(ch),
                          channelAriaLabel: (ch: NotificationChannel, name: string) =>
                            t("channelAriaLabel", { channel: tChannel(ch), name }),
                        }}
                        pushDisabled={pushDisabled}
                        pushDisabledTooltip={t("pushDisabledTooltip")}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </>
      )}

      {!loading && !loadError && catalog && catalog.length === 0 && (
        <Card>
          <CardContent className="py-6 text-center">
            <p className="text-sm font-medium text-foreground">{t("empty")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("emptyDescription")}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── EmailCategoryRow ─────────────────────────────────────────────────────
function EmailCategoryRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex-shrink-0">
        <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
      </div>
    </div>
  );
}

// ─── PerKeyRow ────────────────────────────────────────────────────────────
function PerKeyRow({
  entry,
  prefs,
  locale,
  onChannelToggle,
  onTestSend,
  isTestSending,
  labels,
  pushDisabled,
  pushDisabledTooltip,
}: {
  entry: NotificationCatalogEntry;
  prefs: NotificationPreference;
  locale: CatalogLocale;
  onChannelToggle: (
    entry: NotificationCatalogEntry,
    channel: NotificationChannel,
    next: boolean,
  ) => void;
  onTestSend: (entry: NotificationCatalogEntry) => void;
  isTestSending: boolean;
  labels: {
    mandatoryBadge: string;
    mandatoryTooltip: string;
    mandatorySrHint: string;
    testSend: string;
    testSendSending: string;
    testSendAria: (name: string) => string;
    testSendMandatoryTooltip: string;
    channelLabel: (ch: NotificationChannel) => string;
    channelAriaLabel: (ch: NotificationChannel, name: string) => string;
  };
  pushDisabled: boolean;
  pushDisabledTooltip: string;
}) {
  const name = pickDisplay(entry, locale);
  const description = pickDescription(entry, locale);
  const locked = !entry.userOptOutAllowed;

  const rawValue: NotificationPreferenceValue | null | undefined =
    prefs.byKey?.[entry.key] ?? entry.userPreference;

  const effective = useMemo(() => {
    const map: Partial<Record<NotificationChannel, boolean>> = {};
    for (const ch of entry.supportedChannels) {
      if (locked) {
        map[ch] = entry.effectiveChannels[ch] ?? true;
        continue;
      }
      if (rawValue === undefined || rawValue === null) {
        map[ch] = entry.effectiveChannels[ch] ?? true;
      } else if (typeof rawValue === "boolean") {
        map[ch] = rawValue;
      } else {
        const channelValue = rawValue[ch];
        map[ch] = channelValue === undefined ? true : channelValue;
      }
    }
    return map;
  }, [entry, locked, rawValue]);

  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-foreground">
            {name}
            {locked && (
              <Lock className="ml-1.5 inline h-3 w-3 text-muted-foreground" aria-hidden="true" />
            )}
          </p>
          {locked && (
            <Tooltip content={labels.mandatoryTooltip} position="top">
              <Badge variant="outline" className="text-[10px]">
                {labels.mandatoryBadge}
              </Badge>
            </Tooltip>
          )}
        </div>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        {locked && <span className="sr-only">{labels.mandatorySrHint}</span>}
      </div>
      <div className="flex flex-col items-stretch gap-3 sm:items-end">
        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
          {CHANNEL_ORDER.filter((ch) => entry.supportedChannels.includes(ch)).map((ch) => {
            const switchId = `notif-${entry.key.replace(/[.:]/g, "-")}-${ch}`;
            const channelLocked = locked || (ch === "push" && pushDisabled);
            const switchNode = (
              <Switch
                id={switchId}
                checked={effective[ch] ?? true}
                onCheckedChange={(next) => onChannelToggle(entry, ch, next)}
                disabled={channelLocked}
                aria-label={labels.channelAriaLabel(ch, name)}
              />
            );
            const tooltipCopy = locked
              ? labels.mandatoryTooltip
              : ch === "push" && pushDisabled
                ? pushDisabledTooltip
                : null;
            return (
              <label
                key={ch}
                htmlFor={switchId}
                className={`flex items-center gap-1.5 text-[11px] font-medium ${
                  channelLocked ? "opacity-60" : "cursor-pointer"
                }`}
              >
                <span className="text-muted-foreground">{labels.channelLabel(ch)}</span>
                {tooltipCopy ? (
                  <Tooltip content={tooltipCopy} position="left">
                    {switchNode}
                  </Tooltip>
                ) : (
                  switchNode
                )}
              </label>
            );
          })}
        </div>
        <div className="sm:text-right">
          {locked ? (
            <Tooltip content={labels.testSendMandatoryTooltip} position="left">
              <Button variant="outline" size="sm" disabled aria-disabled>
                <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {labels.testSend}
              </Button>
            </Tooltip>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onTestSend(entry)}
              disabled={isTestSending}
              aria-label={labels.testSendAria(name)}
            >
              {isTestSending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  {labels.testSendSending}
                </>
              ) : (
                <>
                  <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {labels.testSend}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
