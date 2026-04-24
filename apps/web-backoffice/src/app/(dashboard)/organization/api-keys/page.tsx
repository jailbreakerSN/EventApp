"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  useRotateApiKey,
} from "@/hooks/use-api-keys";
import { usePlanGating } from "@/hooks/use-plan-gating";
import {
  Button,
  Badge,
  Card,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  EmptyState,
  InlineErrorBanner,
  Input,
  QueryError,
  Skeleton,
} from "@teranga/shared-ui";
import type { ApiKey, ApiKeyScope } from "@teranga/shared-types";
import { Key, Plus, Copy, Check, RefreshCw, Ban, AlertTriangle, Lock } from "lucide-react";
import { toast } from "sonner";

/**
 * T2.3 — /organization/api-keys
 *
 * Issuance + lifecycle console for organization-scoped API keys.
 * Gated behind the `apiAccess` plan feature (enterprise tier). The
 * plan check below renders a locked state for non-enterprise orgs so
 * the sidebar link doesn't dead-end into a 403 from the API — same
 * pattern as the SMS communications gate.
 *
 * Critical UX contract:
 *   - Plaintext is shown ONCE, in a modal with a prominent copy
 *     button and a "I've copied it" acknowledgement that must be
 *     clicked before the modal can be closed.
 *   - Revoke is a destructive action — confirmation dialog.
 *   - Rotate is an atomic "revoke + reissue" — the new plaintext
 *     appears in the same one-time modal.
 */

const ALL_SCOPES: { key: ApiKeyScope; label: string; hint: string }[] = [
  {
    key: "event:read",
    label: "Lecture événements",
    hint: "Voir les événements et leurs détails (liste, agenda, statut)",
  },
  {
    key: "registration:read_all",
    label: "Lecture inscriptions",
    hint: "Exporter la liste des participants (sync CRM, reporting)",
  },
  {
    key: "badge:generate",
    label: "Génération de badges",
    hint: "Déclencher la génération PDF de badges en volume",
  },
  {
    key: "checkin:scan",
    label: "Check-in / scan",
    hint: "Intégrer un scanner matériel ou un portillon d'accès",
  },
];

export default function ApiKeysPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "";
  const { canUse } = usePlanGating();
  const hasApiAccess = canUse("apiAccess");

  const { data, isLoading, error, refetch } = useApiKeys(orgId, { page: 1, limit: 50 });
  const createMut = useCreateApiKey(orgId);
  const revokeMut = useRevokeApiKey(orgId);
  const rotateMut = useRotateApiKey(orgId);

  const [createOpen, setCreateOpen] = useState(false);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [plaintextDismissed, setPlaintextDismissed] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKey | null>(null);

  const keys = data?.data ?? [];
  const activeCount = useMemo(() => keys.filter((k) => k.status === "active").length, [keys]);

  if (!orgId) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Key}
          title="Aucune organisation sélectionnée"
          description="Connectez-vous avec un compte organisateur pour gérer vos clés API."
        />
      </div>
    );
  }

  // Downgraded-org branch: plan no longer includes apiAccess, but an
  // existing org may still have active keys that need revocation.
  // We show the upgrade CTA PLUS a read-only list of existing keys so
  // operators can revoke them — never silently hide a live credential
  // the user can't recover through the UI.
  const hasExistingKeys = keys.length > 0;

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Key className="h-6 w-6" /> Clés API
          </h1>
          <p className="text-muted-foreground mt-1">
            {activeCount} {activeCount === 1 ? "clé active" : "clés actives"} ·
            <span className="ml-1">Plaintext affiché une seule fois à la création.</span>
          </p>
        </div>
        {hasApiAccess && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Nouvelle clé
          </Button>
        )}
      </header>

      {!hasApiAccess && (
        /* Downgraded org with pre-existing keys. Show the upgrade CTA
           ABOVE the list (warning, not locked) so operators can still
           see + revoke legacy keys. New issuance is blocked server-side
           and the button is hidden above. */
        <Card className="p-6 bg-amber-50 border-amber-200">
          <div className="flex items-start gap-3">
            <Lock className="h-5 w-5 text-amber-700 mt-0.5" aria-hidden />
            <div className="flex-1">
              <h2 className="font-semibold text-amber-900">
                Plan Enterprise requis pour émettre de nouvelles clés
              </h2>
              <p className="text-sm text-amber-800 mt-1">
                {hasExistingKeys
                  ? "Vos clés existantes restent fonctionnelles. Vous pouvez les révoquer ci-dessous à tout moment."
                  : "Mettez à niveau votre abonnement pour intégrer Teranga à vos outils internes."}
              </p>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => (window.location.href = "/organization/billing")}
              >
                Passer au plan Enterprise
              </Button>
            </div>
          </div>
        </Card>
      )}

      {error ? (
        <QueryError
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : keys.length === 0 ? (
        <EmptyState
          icon={Key}
          title="Aucune clé émise"
          description="Créez votre première clé pour intégrer Teranga à vos outils."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Créer une clé
            </Button>
          }
        />
      ) : (
        <Card className="divide-y">
          {keys.map((k) => (
            <ApiKeyRow
              key={k.id}
              apiKey={k}
              allowRotate={hasApiAccess}
              onRevoke={() => setConfirmRevoke(k)}
              onRotate={async () => {
                try {
                  const result = await rotateMut.mutateAsync({ apiKeyId: k.id });
                  setPlaintext(result.data.plaintext);
                  setPlaintextDismissed(false);
                } catch {
                  toast.error("Rotation échouée — réessayez.");
                }
              }}
            />
          ))}
        </Card>
      )}

      {/* Create dialog */}
      <CreateApiKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={async (dto) => {
          try {
            const result = await createMut.mutateAsync(dto);
            setCreateOpen(false);
            setPlaintext(result.data.plaintext);
            setPlaintextDismissed(false);
          } catch {
            toast.error("Création échouée — réessayez.");
          }
        }}
        isPending={createMut.isPending}
      />

      {/* Plaintext reveal (one-time) */}
      <PlaintextModal
        plaintext={plaintext}
        acknowledged={plaintextDismissed}
        onAcknowledge={() => setPlaintextDismissed(true)}
        onClose={() => {
          if (plaintextDismissed) {
            setPlaintext(null);
            setPlaintextDismissed(false);
          }
        }}
      />

      {/* Revoke confirm */}
      {confirmRevoke && (
        <Dialog open onOpenChange={(open) => !open && setConfirmRevoke(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Révoquer cette clé ?</DialogTitle>
              <DialogDescription>
                Les appels utilisant cette clé cesseront de fonctionner immédiatement. Cette action
                est irréversible — vous devrez émettre une nouvelle clé.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmRevoke(null)}>
                Annuler
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  try {
                    await revokeMut.mutateAsync({
                      apiKeyId: confirmRevoke.id,
                      reason: "manual",
                    });
                    toast.success("Clé révoquée.");
                    setConfirmRevoke(null);
                  } catch {
                    toast.error("Révocation échouée — réessayez.");
                  }
                }}
                disabled={revokeMut.isPending}
              >
                {revokeMut.isPending ? "Révocation…" : "Révoquer"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────

function ApiKeyRow({
  apiKey,
  allowRotate,
  onRevoke,
  onRotate,
}: {
  apiKey: ApiKey;
  allowRotate: boolean;
  onRevoke: () => void;
  onRotate: () => void;
}) {
  return (
    <div className="p-4 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold truncate">{apiKey.name}</span>
          <Badge variant={apiKey.status === "active" ? "success" : "neutral"}>
            {apiKey.status === "active" ? "Active" : "Révoquée"}
          </Badge>
          <Badge variant="info">{apiKey.environment}</Badge>
        </div>
        <div className="text-xs font-mono text-muted-foreground mt-1">
          terk_{apiKey.environment}_{apiKey.hashPrefix}…
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {apiKey.scopes.length} scope{apiKey.scopes.length !== 1 ? "s" : ""} ·
          {apiKey.lastUsedAt
            ? ` utilisée ${new Date(apiKey.lastUsedAt).toLocaleString("fr-SN")}`
            : " jamais utilisée"}
        </div>
      </div>
      {apiKey.status === "active" ? (
        <>
          {allowRotate && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRotate}
              aria-label={`Faire tourner la clé ${apiKey.name}`}
            >
              <RefreshCw className="h-4 w-4 mr-2" /> Rotation
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={onRevoke}
            aria-label={`Révoquer la clé ${apiKey.name}`}
          >
            <Ban className="h-4 w-4 mr-2" /> Révoquer
          </Button>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">
          {apiKey.revokedAt
            ? `Révoquée ${new Date(apiKey.revokedAt).toLocaleDateString("fr-SN")}`
            : "Révoquée"}
        </span>
      )}
    </div>
  );
}

// ─── Create Dialog ────────────────────────────────────────────────────────

function CreateApiKeyDialog({
  open,
  onOpenChange,
  onCreate,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (dto: { name: string; scopes: ApiKeyScope[]; environment: "live" | "test" }) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<ApiKeyScope>>(new Set());
  const [environment, setEnvironment] = useState<"live" | "test">("live");

  const canSubmit = name.trim().length > 0 && scopes.size > 0 && !isPending;

  const reset = () => {
    setName("");
    setScopes(new Set());
    setEnvironment("live");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Créer une clé API</DialogTitle>
          <DialogDescription>
            Choisissez un nom descriptif et les scopes minimum nécessaires. Le plaintext sera
            affiché UNE SEULE fois.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium" htmlFor="api-key-name">
              Nom
            </label>
            <Input
              id="api-key-name"
              placeholder="Ex : Scanner iPad #3"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </div>

          <div>
            <p className="text-sm font-medium">Environnement</p>
            <div className="flex gap-2 mt-1" role="radiogroup" aria-label="Environnement">
              {(["live", "test"] as const).map((env) => (
                <button
                  key={env}
                  type="button"
                  role="radio"
                  aria-checked={environment === env}
                  onClick={() => setEnvironment(env)}
                  className={`px-3 py-1.5 text-sm rounded border ${
                    environment === env
                      ? "border-teranga-navy bg-teranga-navy text-white"
                      : "border-gray-300"
                  }`}
                >
                  {env === "live" ? "Production" : "Test"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium">Scopes</p>
            <div className="space-y-2 mt-1">
              {ALL_SCOPES.map((scope) => {
                const selected = scopes.has(scope.key);
                return (
                  <label
                    key={scope.key}
                    className="flex items-start gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        const next = new Set(scopes);
                        if (e.target.checked) next.add(scope.key);
                        else next.delete(scope.key);
                        setScopes(next);
                      }}
                      aria-describedby={`scope-hint-${scope.key}`}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="font-medium text-sm">{scope.label}</div>
                      <div className="text-xs text-muted-foreground" id={`scope-hint-${scope.key}`}>
                        {scope.hint}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {scopes.size === 0 && <InlineErrorBanner title="Sélectionnez au moins un scope." />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              onCreate({
                name: name.trim(),
                scopes: Array.from(scopes),
                environment,
              });
            }}
          >
            {isPending ? "Création…" : "Créer la clé"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Plaintext Reveal (one-time) ──────────────────────────────────────────

function PlaintextModal({
  plaintext,
  acknowledged,
  onAcknowledge,
  onClose,
}: {
  plaintext: string | null;
  acknowledged: boolean;
  onAcknowledge: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copyToClipboard() {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      toast.success("Clé copiée dans le presse-papiers.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Impossible de copier — sélectionnez-la manuellement.");
    }
  }

  return (
    <Dialog open={!!plaintext} onOpenChange={(o) => !o && acknowledged && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Copiez votre clé maintenant
          </DialogTitle>
          <DialogDescription>
            Cette clé ne sera plus jamais affichée. Stockez-la dans votre gestionnaire de secrets
            immédiatement.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2 items-center bg-gray-50 border rounded p-3">
            <code
              className="flex-1 font-mono text-xs break-all select-all"
              aria-label="Clé API plaintext"
            >
              {plaintext}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={copyToClipboard}
              aria-label="Copier la clé"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>

          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => e.target.checked && onAcknowledge()}
              className="mt-0.5"
            />
            <span>
              J'ai copié la clé et je l'ai stockée en lieu sûr. Je comprends que je ne pourrai plus
              la récupérer.
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button onClick={onClose} disabled={!acknowledged}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
