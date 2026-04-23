"use client";

/**
 * Phase 2.4 — Preview + Test-send dialog for the super-admin notification
 * control plane. Opens from the row's "Aperçu" button and surfaces:
 *   - Locale switcher (fr / en / wo) — re-renders on change.
 *   - HTML preview in a sandboxed iframe (srcdoc) — matches what a real
 *     recipient would see.
 *   - Test-send form (email + "envoyer") that routes through the
 *     /test-send endpoint with testMode=true on the server.
 *
 * Rate-limit friendliness:
 *   - 60s client-side debounce on the Test-send button after each send
 *     (the server enforces 10 sends/hour — this keeps admins from hammering
 *     the button while one message is in flight).
 */

import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  InlineErrorBanner,
  Input,
  Select,
} from "@teranga/shared-ui";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { adminNotificationsApi, type AdminNotificationRow } from "@/lib/api-client";
import { useErrorHandler } from "@/hooks/use-error-handler";

type Locale = "fr" | "en" | "wo";

interface PreviewDialogProps {
  row: AdminNotificationRow;
  onClose: () => void;
}

export function PreviewDialog({ row, onClose }: PreviewDialogProps) {
  const { resolve } = useErrorHandler();
  const [locale, setLocale] = useState<Locale>("fr");
  const [html, setHtml] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState<string>("");
  const [sendDisabledUntil, setSendDisabledUntil] = useState<number>(0);
  const [sending, setSending] = useState<boolean>(false);
  const [now, setNow] = useState<number>(Date.now());

  // Tick for the 60s cool-down countdown on the test-send button.
  useEffect(() => {
    if (sendDisabledUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sendDisabledUntil]);

  // (Re-)fetch the preview whenever the locale changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    adminNotificationsApi
      .preview(row.key, { locale })
      .then((res) => {
        if (cancelled) return;
        setHtml(res.data.html);
        setSubject(res.data.subject);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(resolve(err).description);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [row.key, locale, resolve]);

  const cooldownRemaining = Math.max(0, Math.ceil((sendDisabledUntil - now) / 1000));
  const sendDisabled = sending || cooldownRemaining > 0 || !testEmail;

  async function handleTestSend() {
    if (sendDisabled) return;
    setSending(true);
    try {
      const res = await adminNotificationsApi.testSend(row.key, {
        email: testEmail,
        locale,
      });
      toast.success(
        res.data.previewSubject
          ? `Message de test envoyé : ${res.data.previewSubject}`
          : "Message de test envoyé",
      );
      // Client-side cool-down so the button blocks for 60s after each send.
      setSendDisabledUntil(Date.now() + 60_000);
      setNow(Date.now());
    } catch (err) {
      toast.error(resolve(err).description);
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-w-4xl" closeLabel="Fermer">
        <DialogHeader>
          <DialogTitle>Aperçu de la notification</DialogTitle>
          <DialogDescription>
            <code className="font-mono text-[11px]">{row.key}</code>
            <span className="mx-2">·</span>
            {row.displayName.fr}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Locale switcher */}
          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor="preview-locale"
              className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
            >
              Langue
            </label>
            <Select
              id="preview-locale"
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              className="max-w-xs"
              aria-label="Choisir la langue d'aperçu"
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
              <option value="wo">Wolof</option>
            </Select>
          </div>

          {/* Subject preview */}
          {subject && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Sujet
              </div>
              <div className="mt-1 font-medium text-foreground">{subject}</div>
            </div>
          )}

          {/* HTML preview */}
          {loadError && (
            <InlineErrorBanner
              severity="destructive"
              kicker="— Erreur"
              title="Impossible de générer l'aperçu"
              description={loadError}
            />
          )}
          <div className="overflow-hidden rounded-md border border-border bg-white">
            {loading ? (
              <div className="flex min-h-[420px] items-center justify-center text-xs text-muted-foreground">
                Chargement de l'aperçu...
              </div>
            ) : (
              <iframe
                // srcdoc sandbox keeps template HTML isolated from our page
                // scripts; the html was rendered server-side by react-email.
                sandbox=""
                srcDoc={html}
                title="Aperçu de la notification"
                className="h-[520px] w-full border-0"
              />
            )}
          </div>

          {/* Test send */}
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="text-sm font-medium text-foreground">Envoyer un e-mail de test</div>
            <p className="text-xs text-muted-foreground">
              Contourne les paramètres de désactivation, la liste de suppression et l'opt-out
              utilisateur. Un audit est enregistré pour chaque envoi de test.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="email"
                placeholder="admin@teranga.events"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                className="max-w-sm"
                aria-label="Adresse e-mail destinataire du test"
              />
              <Button
                onClick={() => void handleTestSend()}
                disabled={sendDisabled}
                aria-label="Envoyer un e-mail de test"
              >
                <Send className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                {sending
                  ? "Envoi..."
                  : cooldownRemaining > 0
                    ? `Patientez ${cooldownRemaining}s`
                    : "Envoyer"}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
