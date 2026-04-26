"use client";

/**
 * Organizer overhaul — Phase O10.
 *
 * Modal that mints a magic link for a speaker / sponsor and shows it
 * to the operator ONCE so they can copy / send it via their preferred
 * channel (email client, WhatsApp, SMS).
 *
 * Two states:
 *   1. **Form** — role + resourceId + recipient email + TTL.
 *   2. **Issued** — readonly link + copy button + "Send via mail"
 *      shortcut. Closing the modal discards the plaintext token —
 *      the token is never persisted by the UI.
 *
 * The plaintext token is intentionally surfaced ONCE — re-opening
 * this dialog after close requires re-issuing (same security model
 * as the API key flow).
 */

import { useEffect, useState, type FormEvent } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  InlineErrorBanner,
  Input,
  Select,
} from "@teranga/shared-ui";
import { Copy, KeyRound, Send } from "lucide-react";
import { toast } from "sonner";
import { useIssueMagicLink } from "@/hooks/use-magic-links";
import { useErrorHandler, type ResolvedError } from "@/hooks/use-error-handler";
import type { MagicLinkRole } from "@teranga/shared-types";

export interface IssueMagicLinkDialogProps {
  open: boolean;
  onClose: () => void;
  /** Pre-fill role + resourceId when invoked from a speaker / sponsor row. */
  defaultRole?: MagicLinkRole;
  defaultResourceId?: string;
  defaultEventId: string;
  /**
   * The base URL the magic link will land on. Defaults to
   * `<origin>/portal/<role>?token=<token>`. Override only for tests.
   */
  buildPortalUrl?: (token: string, role: MagicLinkRole) => string;
}

function defaultBuildPortalUrl(token: string, role: MagicLinkRole): string {
  // We use `origin` so deployments at staging.teranga / preview / prod
  // all generate the right link. Falls back gracefully when SSR runs
  // (`window` is undefined during prerender).
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/portal/${role}?token=${encodeURIComponent(token)}`;
}

export function IssueMagicLinkDialog({
  open,
  onClose,
  defaultRole = "speaker",
  defaultResourceId = "",
  defaultEventId,
  buildPortalUrl = defaultBuildPortalUrl,
}: IssueMagicLinkDialogProps) {
  const issue = useIssueMagicLink();
  const { resolve: resolveError } = useErrorHandler();

  const [role, setRole] = useState<MagicLinkRole>(defaultRole);
  const [resourceId, setResourceId] = useState(defaultResourceId);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [ttlHours, setTtlHours] = useState(48);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [error, setError] = useState<ResolvedError | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  // Reset on every (re)open. The previous token MUST NOT linger in
  // memory once the dialog closes.
  useEffect(() => {
    if (open) {
      setRole(defaultRole);
      setResourceId(defaultResourceId);
      setRecipientEmail("");
      setTtlHours(48);
      setValidationError(null);
      setError(null);
      setIssuedToken(null);
    }
  }, [open, defaultRole, defaultResourceId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setError(null);
    if (!resourceId.trim()) {
      setValidationError("Renseignez l'identifiant de l'intervenant ou du sponsor.");
      return;
    }
    if (!recipientEmail.trim()) {
      setValidationError("Email du destinataire requis.");
      return;
    }
    try {
      const result = await issue.mutateAsync({
        role,
        resourceId: resourceId.trim(),
        eventId: defaultEventId,
        recipientEmail: recipientEmail.trim(),
        ttlHours,
      });
      setIssuedToken(result.token);
      toast.success("Lien généré", {
        description: "Copiez-le et envoyez-le au destinataire — il ne sera pas affiché à nouveau.",
      });
    } catch (err) {
      setError(resolveError(err));
    }
  };

  const portalUrl = issuedToken ? buildPortalUrl(issuedToken, role) : "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(portalUrl);
      toast.success("Lien copié", {
        description: "Collez-le dans votre messagerie ou WhatsApp pour l'envoyer.",
      });
    } catch {
      toast.error("Copie impossible", {
        description: "Sélectionnez le lien manuellement et copiez-le.",
      });
    }
  };

  const handleMailto = () => {
    const subject = encodeURIComponent("Votre accès au portail Teranga");
    const body = encodeURIComponent(
      `Bonjour,\n\nVoici votre lien d'accès personnel au portail Teranga (valide ${ttlHours} h) :\n\n${portalUrl}\n\nÀ bientôt,\nL'équipe`,
    );
    window.location.href = `mailto:${recipientEmail}?subject=${subject}&body=${body}`;
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-teranga-gold" aria-hidden="true" />
            Lien d&apos;accès magique
          </DialogTitle>
          <DialogDescription>
            {issuedToken
              ? "Copiez ce lien immédiatement — il ne sera plus affiché. Le destinataire pourra éditer son profil pendant la durée de validité."
              : "Générez un lien personnel sans création de compte. Le destinataire pourra modifier son profil pendant la durée de validité."}
          </DialogDescription>
        </DialogHeader>

        {validationError && (
          <InlineErrorBanner
            severity="warning"
            title="Champ manquant"
            description={validationError}
            onDismiss={() => setValidationError(null)}
            dismissLabel="Fermer"
          />
        )}
        {error && (
          <InlineErrorBanner
            title={error.title}
            description={error.description}
            onDismiss={() => setError(null)}
            dismissLabel="Fermer"
          />
        )}

        {!issuedToken ? (
          <form onSubmit={submit} className="space-y-3">
            <FormField label="Rôle" htmlFor="ml-role">
              <Select
                id="ml-role"
                value={role}
                onChange={(e) => setRole(e.target.value as MagicLinkRole)}
              >
                <option value="speaker">Intervenant</option>
                <option value="sponsor">Sponsor</option>
              </Select>
            </FormField>
            <FormField label="Identifiant du profil" htmlFor="ml-resource">
              <Input
                id="ml-resource"
                value={resourceId}
                onChange={(e) => setResourceId(e.target.value)}
                placeholder={role === "speaker" ? "spk-…" : "spn-…"}
                required
              />
            </FormField>
            <FormField label="Email du destinataire" htmlFor="ml-email">
              <Input
                id="ml-email"
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Durée de validité (heures)" htmlFor="ml-ttl">
              <Input
                id="ml-ttl"
                type="number"
                min={1}
                max={168}
                value={ttlHours}
                onChange={(e) => setTtlHours(parseInt(e.target.value, 10) || 48)}
              />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Annuler
              </Button>
              <Button type="submit" disabled={issue.isPending}>
                {issue.isPending ? "Génération…" : "Générer le lien"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-3">
            <FormField label="Lien personnel" htmlFor="ml-issued">
              <Input id="ml-issued" value={portalUrl} readOnly onFocus={(e) => e.target.select()} />
            </FormField>
            <p className="text-[11px] text-muted-foreground">
              Valide {ttlHours} h. Ne sera pas réaffiché. En cas de perte, révoquez et régénérez.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleCopy}>
                <Copy className="h-4 w-4 mr-1.5" aria-hidden="true" />
                Copier
              </Button>
              <Button type="button" onClick={handleMailto}>
                <Send className="h-4 w-4 mr-1.5" aria-hidden="true" />
                Envoyer par email
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
