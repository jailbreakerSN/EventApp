"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Bell,
  Mail,
  Smartphone,
  Clock,
  Eye,
  MessageSquare,
  Trash2,
  Shield,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from "@/hooks/use-notifications";
import { Button, Card, CardContent, SectionHeader } from "@teranga/shared-ui";

function Toggle({
  checked,
  onChange,
  label,
  description,
  icon: Icon,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  icon: typeof Bell;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-muted-foreground" />
        <div>
          <span className="text-sm font-medium">{label}</span>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
          checked ? "bg-teranga-gold dark:bg-teranga-gold-light" : "bg-muted"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </label>
  );
}

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tNotifications = useTranslations("settings.notifications");
  const tPrivacy = useTranslations("settings.privacy");
  const tAccount = useTranslations("settings.account");
  const { data, isLoading } = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();

  const prefs = (
    data as {
      data?: {
        push?: boolean;
        sms?: boolean;
        email?: boolean;
        // Phase 3c.3 per-category fields. Missing = fall back to the
        // legacy `email` aggregate (which defaults to true).
        emailTransactional?: boolean;
        emailOrganizational?: boolean;
        eventReminders?: boolean;
        quietHoursStart?: string | null;
        quietHoursEnd?: string | null;
      };
    }
  )?.data;

  // Helper: compute the effective per-category toggle state. Mirrors the
  // API's `isEmailCategoryEnabled` so the UI shows what the server will
  // actually honor. Returns the legacy `email` aggregate when the
  // per-category field is undefined — keeps existing users seeing their
  // previous choice without a migration.
  const emailTransactional = prefs?.emailTransactional ?? prefs?.email ?? true;
  const emailOrganizational = prefs?.emailOrganizational ?? prefs?.email ?? true;

  const [profileVisible, setProfileVisible] = useState(true);
  const [allowDirectMessages, setAllowDirectMessages] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("teranga-privacy");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.profileVisible === "boolean") setProfileVisible(parsed.profileVisible);
        if (typeof parsed.allowDirectMessages === "boolean")
          setAllowDirectMessages(parsed.allowDirectMessages);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-7 bg-muted rounded w-1/3"></div>
          <div className="space-y-4">
            <div className="h-32 bg-muted rounded-lg"></div>
            <div className="h-32 bg-muted rounded-lg"></div>
            <div className="h-24 bg-muted rounded-lg"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8 space-y-6">
      <SectionHeader kicker={t("kicker")} title={t("title")} size="hero" as="h1" />

      {/* Notification Preferences */}
      <Card>
        <CardContent className="space-y-4 py-6">
          <h2 className="font-serif-display flex items-center gap-2 text-[20px] font-semibold tracking-[-0.015em]">
            <Bell className="h-5 w-5 text-teranga-gold" />
            {tNotifications("heading")}
          </h2>
          <p className="text-sm text-muted-foreground">{tNotifications("description")}</p>

          <div className="space-y-2">
            <Toggle
              icon={Bell}
              label={tNotifications("push")}
              description={tNotifications("pushDescription")}
              checked={prefs?.push ?? true}
              onChange={(v) => update.mutate({ push: v })}
            />
            <Toggle
              icon={Smartphone}
              label={tNotifications("sms")}
              description={tNotifications("smsDescription")}
              checked={prefs?.sms ?? true}
              onChange={(v) => update.mutate({ sms: v })}
            />
            <Toggle
              icon={Mail}
              label={tNotifications("emailTransactional")}
              description={tNotifications("emailTransactionalDescription")}
              checked={emailTransactional}
              onChange={(v) => update.mutate({ emailTransactional: v })}
            />
            <Toggle
              icon={Mail}
              label={tNotifications("emailOrganizational")}
              description={tNotifications("emailOrganizationalDescription")}
              checked={emailOrganizational}
              onChange={(v) => update.mutate({ emailOrganizational: v })}
            />
            <Toggle
              icon={Clock}
              label={tNotifications("reminders")}
              description={tNotifications("remindersDescription")}
              checked={prefs?.eventReminders ?? true}
              onChange={(v) => update.mutate({ eventReminders: v })}
            />
            <p className="text-xs text-muted-foreground mt-2">
              {tNotifications("mandatoryEmailNote")}
            </p>
          </div>

          {/* Phase 3 — deep-link to the per-key preferences page. Kept
              distinct from the channel-level toggles above so users who
              just want to mute marketing can do it in one click, while
              power users still get granular control. */}
          <Link
            href="/settings/notifications"
            className="mt-4 flex items-center justify-between rounded-lg border border-teranga-gold/30 bg-teranga-gold/5 p-4 transition-colors hover:bg-teranga-gold/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teranga-gold focus-visible:ring-offset-2"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                {tNotifications("detailedLink")}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {tNotifications("detailedLinkDescription")}
              </p>
            </div>
            <ChevronRight
              className="h-5 w-5 flex-shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </Link>
        </CardContent>
      </Card>

      {/* Privacy */}
      <Card>
        <CardContent className="space-y-4 py-6">
          <h2 className="font-serif-display flex items-center gap-2 text-[20px] font-semibold tracking-[-0.015em]">
            <Shield className="h-5 w-5 text-teranga-gold" />
            {tPrivacy("heading")}
          </h2>
          <p className="text-sm text-muted-foreground">{tPrivacy("description")}</p>

          <div className="space-y-2">
            <Toggle
              icon={Eye}
              label={tPrivacy("profileVisible")}
              description={tPrivacy("profileVisibleDescription")}
              checked={profileVisible}
              onChange={(v) => {
                setProfileVisible(v);
                try {
                  localStorage.setItem(
                    "teranga-privacy",
                    JSON.stringify({ profileVisible: v, allowDirectMessages }),
                  );
                } catch {
                  /* ignore */
                }
                toast.success(v ? tPrivacy("profileVisibleOn") : tPrivacy("profileVisibleOff"));
              }}
            />
            <Toggle
              icon={MessageSquare}
              label={tPrivacy("dmAllowed")}
              description={tPrivacy("dmAllowedDescription")}
              checked={allowDirectMessages}
              onChange={(v) => {
                setAllowDirectMessages(v);
                try {
                  localStorage.setItem(
                    "teranga-privacy",
                    JSON.stringify({ profileVisible, allowDirectMessages: v }),
                  );
                } catch {
                  /* ignore */
                }
                toast.success(v ? tPrivacy("dmAllowedOn") : tPrivacy("dmAllowedOff"));
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Account / Danger Zone */}
      <Card className="border-destructive/30">
        <CardContent className="space-y-4 py-6">
          <h2 className="font-serif-display flex items-center gap-2 text-[20px] font-semibold tracking-[-0.015em] text-destructive">
            <Trash2 className="h-5 w-5" />
            {tAccount("heading")}
          </h2>
          <p className="text-sm text-muted-foreground">{tAccount("description")}</p>

          {!showDeleteConfirm ? (
            <Button
              variant="outline"
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {tAccount("delete")}
            </Button>
          ) : (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
              <p className="text-sm text-destructive font-medium">
                {tAccount("deleteConfirmQuestion")}
              </p>
              <p className="text-xs text-muted-foreground">{tAccount("deleteConfirmWarning")}</p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    toast.info(tAccount("deleteContactSupport"));
                  }}
                  className="flex-1"
                >
                  {tAccount("deleteConfirm")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1"
                >
                  {tAccount("deleteCancel")}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
