"use client";

import { Bell, Mail, Smartphone } from "lucide-react";
import { useNotificationPreferences, useUpdateNotificationPreferences } from "@/hooks/use-notifications";
import { Card, CardContent, Spinner } from "@teranga/shared-ui";

function Toggle({ checked, onChange, label, icon: Icon }: { checked: boolean; onChange: (v: boolean) => void; label: string; icon: typeof Bell }) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-muted-foreground" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? "bg-teranga-gold" : "bg-muted"
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
  const { data, isLoading } = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();

  const prefs = (data as { data?: { push?: boolean; sms?: boolean; email?: boolean; quietHoursStart?: string | null; quietHoursEnd?: string | null } })?.data;

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center"><Spinner size="lg" /></div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">Parametres</h1>

      <Card>
        <CardContent className="space-y-4 py-6">
          <h2 className="text-lg font-semibold">Notifications</h2>
          <p className="text-sm text-muted-foreground">Choisissez comment recevoir vos notifications</p>

          <div className="space-y-2">
            <Toggle
              icon={Bell}
              label="Notifications push"
              checked={prefs?.push ?? true}
              onChange={(v) => update.mutate({ push: v })}
            />
            <Toggle
              icon={Smartphone}
              label="SMS"
              checked={prefs?.sms ?? true}
              onChange={(v) => update.mutate({ sms: v })}
            />
            <Toggle
              icon={Mail}
              label="Email"
              checked={prefs?.email ?? true}
              onChange={(v) => update.mutate({ email: v })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
