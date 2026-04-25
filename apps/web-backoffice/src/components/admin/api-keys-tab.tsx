"use client";

/**
 * A.2 closure — API key issuance UI scoped to a single organization.
 *
 * Mounts inside `<EntityDetailLayout>` on `/admin/organizations/[orgId]`
 * as the "Clés API" tab. Surfaces the existing per-org backend
 * (`apiKeysApi.list / create / rotate / revoke` → `/v1/organizations/
 * :orgId/api-keys/*`) so a super-admin can hand an enterprise customer
 * a working credential without leaving the back-office.
 *
 * Security model:
 *  - The plaintext is returned by the server EXACTLY ONCE on issue /
 *    rotate. We display it inside an `<NewKeySecretModal>` with a
 *    copy-to-clipboard CTA and a single "J'ai noté la clé" dismissal.
 *    No state outside this modal ever holds the plaintext, and we
 *    deliberately avoid storing it in React Query so a tab re-render
 *    never re-exposes it.
 *  - Every action is gated server-side by `organization:manage_billing`
 *    (issue / rotate / revoke) and `organization:read` (list). Super-
 *    admin satisfies both via the `platform:manage` safety-net.
 *  - Rotate is "revoke + issue" atomically. The UI shows the OLD
 *    `hashPrefix` next to the new one for ~24h so any caller that
 *    sees an unauthorised request from the prefix can correlate.
 */

import { useState } from "react";
import {
  Badge,
  Card,
  CardContent,
  Spinner,
  InlineErrorBanner,
} from "@teranga/shared-ui";
import {
  KeyRound,
  Copy,
  Check,
  RefreshCw,
  Ban,
  Plus,
  AlertTriangle,
  History,
  Activity,
} from "lucide-react";
import {
  type ApiKey,
  type ApiKeyScope,
  ApiKeyScopeSchema,
} from "@teranga/shared-types";
import Link from "next/link";
import {
  useOrgApiKeys,
  useCreateOrgApiKey,
  useRotateOrgApiKey,
  useRevokeOrgApiKey,
  useAdminAuditLogs,
  useOrgApiKeyUsage,
} from "@/hooks/use-admin";
import { useErrorHandler } from "@/hooks/use-error-handler";

// ─── Component ───────────────────────────────────────────────────────────

const ALL_SCOPES = ApiKeyScopeSchema.options;

const SCOPE_LABEL: Record<ApiKeyScope, string> = {
  "event:read": "Lecture des événements",
  "registration:read_all": "Lecture des inscriptions",
  "badge:generate": "Génération de badges",
  "checkin:scan": "Scan de check-in",
};

const SCOPE_DESCRIPTION: Record<ApiKeyScope, string> = {
  "event:read": "Liste et lecture des événements de l'organisation.",
  "registration:read_all": "Lecture complète des inscriptions (incluant les détails).",
  "badge:generate": "Génération unitaire et en masse des badges PDF.",
  "checkin:scan":
    "Scan QR + check-in manuel + lecture du journal + sync hors-ligne.",
};

export function ApiKeysTab({ orgId, orgName }: { orgId: string; orgName: string }) {
  const { data, isLoading, isError, error, refetch } = useOrgApiKeys(orgId);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSecret, setNewSecret] = useState<{
    plaintext: string;
    keyId: string;
    rotationOf?: string;
  } | null>(null);

  const keys: ApiKey[] = data?.data ?? [];
  const activeCount = keys.filter((k) => k.status === "active").length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
        <Spinner />
      </div>
    );
  }

  if (isError) {
    return (
      <InlineErrorBanner
        severity="destructive"
        kicker="— Erreur"
        title="Impossible de charger les clés API"
        description={error instanceof Error ? error.message : "Erreur inconnue"}
        actions={[{ label: "Réessayer", onClick: () => void refetch() }]}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header + create CTA */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">
            {keys.length === 0
              ? "Aucune clé API émise pour cette organisation."
              : `${activeCount} clé${activeCount > 1 ? "s" : ""} active${activeCount > 1 ? "s" : ""} sur ${keys.length} (${keys.length - activeCount} révoquée${keys.length - activeCount > 1 ? "s" : ""}).`}
          </p>
          <p className="text-xs text-muted-foreground">
            La clé en clair n&apos;est affichée qu&apos;à la création — copiez-la immédiatement, elle ne pourra plus être récupérée.
          </p>
        </div>
        {!showCreateForm && (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-teranga-gold px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-teranga-gold/90"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Émettre une clé
          </button>
        )}
      </div>

      {/* Inline create form */}
      {showCreateForm && (
        <CreateApiKeyForm
          orgId={orgId}
          orgName={orgName}
          onCancel={() => setShowCreateForm(false)}
          onCreated={(payload) => {
            setShowCreateForm(false);
            setNewSecret({
              plaintext: payload.plaintext,
              keyId: payload.apiKey.id,
            });
          }}
        />
      )}

      {/* Existing keys list */}
      {keys.length > 0 && (
        <div className="divide-y divide-border rounded-xl border border-border">
          {keys.map((key) => (
            <ApiKeyRow
              key={key.id}
              apiKey={key}
              orgId={orgId}
              onRotated={(payload) =>
                setNewSecret({
                  plaintext: payload.plaintext,
                  keyId: payload.newApiKey.id,
                  rotationOf: payload.revokedApiKeyId,
                })
              }
            />
          ))}
        </div>
      )}

      {/* B4 closure — recent api_key.* audit activity for this org. */}
      <ApiKeyActivityLog orgId={orgId} />


      {/* Plaintext secret modal — visible exactly once after issue/rotate */}
      {newSecret && (
        <NewKeySecretModal
          plaintext={newSecret.plaintext}
          keyId={newSecret.keyId}
          rotationOf={newSecret.rotationOf}
          onClose={() => setNewSecret(null)}
        />
      )}
    </div>
  );
}

// ─── B4 closure — recent activity (api_key.* audit rows) ────────────────

const ACTIVITY_LABEL: Record<string, string> = {
  "api_key.created": "Émission",
  "api_key.rotated": "Rotation",
  "api_key.revoked": "Révocation",
  "api_key.verified": "Vérification (auth)",
};

function ApiKeyActivityLog({ orgId }: { orgId: string }) {
  // Pull the latest api_key.* audit rows for this org. Since the
  // audit query schema accepts `organizationId` we get a server-side
  // filter — no client-side trimming needed. Limit kept low (10)
  // because the row already deep-links to the full audit page if
  // an operator needs the entire history.
  const { data, isLoading } = useAdminAuditLogs({
    organizationId: orgId,
    resourceType: "api_key",
    limit: 10,
    page: 1,
  });

  const rows = data?.data ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-foreground">Activité récente</h3>
        </div>
        <Link
          href={`/admin/audit?resourceType=api_key&organizationId=${encodeURIComponent(orgId)}`}
          className="text-xs font-medium text-teranga-gold hover:underline"
        >
          Voir tout l&apos;audit →
        </Link>
      </div>

      {isLoading && (
        <div className="rounded-xl border border-border p-4 text-xs text-muted-foreground">
          Chargement de l&apos;activité…
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <div className="rounded-xl border border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
          Aucune activité récente sur les clés API de cette organisation.
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <div className="divide-y divide-border rounded-xl border border-border">
          {rows.map((row) => {
            const label = ACTIVITY_LABEL[row.action] ?? row.action;
            const actor =
              (row as unknown as { actorDisplayName?: string }).actorDisplayName ??
              row.actorId;
            return (
              <div key={row.id} className="flex items-start justify-between gap-3 p-3 text-xs">
                <div className="min-w-0">
                  <div className="font-medium text-foreground">{label}</div>
                  <div className="mt-0.5 truncate text-muted-foreground">
                    Acteur :{" "}
                    <code className="font-mono">{actor}</code>
                    {row.resourceId && (
                      <>
                        {" · "}clé{" "}
                        <code className="font-mono">{row.resourceId.slice(0, 12)}…</code>
                      </>
                    )}
                  </div>
                </div>
                <time
                  dateTime={row.timestamp}
                  className="shrink-0 text-[11px] text-muted-foreground"
                >
                  {new Date(row.timestamp).toLocaleString("fr-FR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </time>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Create form ─────────────────────────────────────────────────────────

function CreateApiKeyForm({
  orgId,
  orgName,
  onCancel,
  onCreated,
}: {
  orgId: string;
  orgName: string;
  onCancel: () => void;
  onCreated: (payload: { apiKey: ApiKey; plaintext: string }) => void;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<ApiKeyScope>>(new Set());
  const [environment, setEnvironment] = useState<"live" | "test">("live");
  const create = useCreateOrgApiKey(orgId);
  const { resolve } = useErrorHandler();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleToggleScope = (scope: ApiKeyScope) => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (name.trim().length === 0) {
      setSubmitError("Donnez un nom descriptif à la clé (ex. « Scanner iPad #3 »).");
      return;
    }
    if (scopes.size === 0) {
      setSubmitError("Sélectionnez au moins un scope.");
      return;
    }
    try {
      const result = await create.mutateAsync({
        name: name.trim(),
        scopes: Array.from(scopes),
        environment,
      });
      onCreated(result.data);
    } catch (err) {
      setSubmitError(resolve(err).description);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Nouvelle clé API · {orgName}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="apikey-name" className="text-sm font-medium text-foreground">
              Nom
            </label>
            <input
              id="apikey-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="Scanner iPad #3"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teranga-gold"
            />
            <p className="text-[11px] text-muted-foreground">
              Visible dans la liste, jamais utilisé pour l&apos;authentification.
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">Scopes</legend>
            <p className="text-[11px] text-muted-foreground">
              Cochez le minimum nécessaire — les scopes se traduisent en permissions au runtime.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {ALL_SCOPES.map((scope) => (
                <label
                  key={scope}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 transition-colors hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={scopes.has(scope)}
                    onChange={() => handleToggleScope(scope)}
                    className="mt-0.5 h-4 w-4 rounded border-border text-teranga-gold focus:ring-teranga-gold"
                    aria-label={SCOPE_LABEL[scope]}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">
                      {SCOPE_LABEL[scope]}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {SCOPE_DESCRIPTION[scope]}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">Environnement</span>
            <div className="flex gap-2">
              {(["live", "test"] as const).map((env) => (
                <button
                  type="button"
                  key={env}
                  onClick={() => setEnvironment(env)}
                  aria-pressed={environment === env}
                  className={
                    environment === env
                      ? "rounded-md border border-teranga-gold bg-teranga-gold/10 px-3 py-1.5 text-sm font-medium text-teranga-gold"
                      : "rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
                  }
                >
                  {env === "live" ? "Production (live)" : "Test"}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Une clé « test » porte le préfixe <code className="font-mono">terk_test_</code> ; une clé live porte <code className="font-mono">terk_live_</code>.
            </p>
          </div>

          {submitError && (
            <InlineErrorBanner
              severity="destructive"
              kicker="— Erreur"
              title="Impossible d'émettre la clé"
              description={submitError}
            />
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={create.isPending}
              className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-teranga-gold px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-teranga-gold/90 disabled:opacity-50"
            >
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              {create.isPending ? "Émission…" : "Émettre la clé"}
            </button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────

function ApiKeyRow({
  apiKey,
  orgId,
  onRotated,
}: {
  apiKey: ApiKey;
  orgId: string;
  onRotated: (payload: {
    newApiKey: ApiKey;
    plaintext: string;
    revokedApiKeyId: string;
  }) => void;
}) {
  const [showUsage, setShowUsage] = useState(false);
  const rotate = useRotateOrgApiKey(orgId);
  const revoke = useRevokeOrgApiKey(orgId);
  const { resolve } = useErrorHandler();
  const [actionError, setActionError] = useState<string | null>(null);

  const handleRotate = async () => {
    setActionError(null);
    if (
      !window.confirm(
        `Rotation immédiate de la clé « ${apiKey.name} » ? L'ancienne clé sera révoquée et le nouveau secret sera affiché une seule fois.`,
      )
    ) {
      return;
    }
    try {
      const result = await rotate.mutateAsync({
        apiKeyId: apiKey.id,
        dto: { reason: "Rotation manuelle depuis l'administration" },
      });
      onRotated(result.data);
    } catch (err) {
      setActionError(resolve(err).description);
    }
  };

  const handleRevoke = async () => {
    setActionError(null);
    const reason = window.prompt(
      `Révoquer la clé « ${apiKey.name} » ? Indiquez une raison (visible dans l'audit).`,
      "Révocation manuelle",
    );
    if (reason === null) return;
    try {
      await revoke.mutateAsync({ apiKeyId: apiKey.id, reason });
    } catch (err) {
      setActionError(resolve(err).description);
    }
  };

  const isActive = apiKey.status === "active";

  return (
    <div className="space-y-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{apiKey.name}</span>
            <Badge variant={isActive ? "success" : "neutral"}>
              {isActive ? "Active" : "Révoquée"}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {apiKey.environment}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <code className="font-mono">{apiKey.hashPrefix}…</code>
            <span aria-hidden="true">·</span>
            <span>
              Créée le{" "}
              {new Date(apiKey.createdAt).toLocaleDateString("fr-FR", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </span>
            {apiKey.lastUsedAt && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Dernière utilisation :{" "}
                  {new Date(apiKey.lastUsedAt).toLocaleString("fr-FR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              </>
            )}
            {!apiKey.lastUsedAt && (
              <>
                <span aria-hidden="true">·</span>
                <span>Jamais utilisée</span>
              </>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {apiKey.scopes.map((scope) => (
              <Badge key={scope} variant="outline" className="text-[10px]">
                {SCOPE_LABEL[scope] ?? scope}
              </Badge>
            ))}
          </div>
          {!isActive && apiKey.revocationReason && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              Révoquée le{" "}
              {apiKey.revokedAt &&
                new Date(apiKey.revokedAt).toLocaleString("fr-FR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}{" "}
              · « {apiKey.revocationReason} »
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowUsage((v) => !v)}
            aria-pressed={showUsage}
            className={
              showUsage
                ? "inline-flex items-center gap-1.5 rounded-md border border-teranga-gold bg-teranga-gold/10 px-2.5 py-1 text-xs font-medium text-teranga-gold"
                : "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
            }
            aria-label={`Voir les statistiques d'usage de la clé ${apiKey.name}`}
          >
            <Activity className="h-3.5 w-3.5" aria-hidden="true" />
            Stats
          </button>
          {isActive && (
            <>
              <button
                type="button"
                onClick={() => void handleRotate()}
                disabled={rotate.isPending || revoke.isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                aria-label={`Rotation de la clé ${apiKey.name}`}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Rotation
              </button>
              <button
                type="button"
                onClick={() => void handleRevoke()}
                disabled={rotate.isPending || revoke.isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-background px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/60 dark:hover:bg-red-950/30"
                aria-label={`Révoquer la clé ${apiKey.name}`}
              >
                <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                Révoquer
              </button>
            </>
          )}
        </div>
      </div>
      {showUsage && <ApiKeyUsageChart orgId={orgId} apiKeyId={apiKey.id} />}
      {actionError && (
        <InlineErrorBanner
          severity="destructive"
          kicker="— Erreur"
          title="L'action a échoué"
          description={actionError}
        />
      )}
    </div>
  );
}

// T2.3 closure — 30-day request-volume sparkline. Pure CSS bars, no
// chart library — keeps the bundle lean and the sparkline reads
// well at 200×40 inside a row.
function ApiKeyUsageChart({ orgId, apiKeyId }: { orgId: string; apiKeyId: string }) {
  const { data, isLoading, isError, error } = useOrgApiKeyUsage(orgId, apiKeyId);

  if (isLoading) {
    return (
      <div className="rounded-md border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
        Chargement des statistiques d&apos;usage…
      </div>
    );
  }
  if (isError) {
    return (
      <InlineErrorBanner
        severity="destructive"
        kicker="— Erreur"
        title="Impossible de charger les statistiques"
        description={error instanceof Error ? error.message : "Erreur inconnue"}
      />
    );
  }
  const usage = data?.data;
  if (!usage) return null;

  const max = Math.max(1, ...usage.daily.map((d) => d.count));
  return (
    <div className="rounded-md border border-border bg-muted/10 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="font-medium text-foreground">
          Usage sur 30 jours :{" "}
          <span className="font-mono">{usage.totalLast30d.toLocaleString("fr-FR")}</span>{" "}
          requêtes vérifiées
        </div>
        <div className="text-muted-foreground">
          Borne basse — un événement <code className="font-mono">api_key.verified</code> n&apos;est
          consigné qu&apos;une fois par heure pour un même couple (clé, IP, agent).
        </div>
      </div>
      <div
        className="flex h-10 items-end gap-px"
        role="img"
        aria-label={`Histogramme des requêtes des 30 derniers jours, total ${usage.totalLast30d}`}
      >
        {usage.daily.map((d) => (
          <div
            key={d.day}
            className="flex-1 bg-teranga-gold/60 transition-colors hover:bg-teranga-gold"
            style={{ height: `${Math.max(2, (d.count / max) * 100)}%` }}
            title={`${d.day} : ${d.count} requête${d.count > 1 ? "s" : ""}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{usage.daily[0]?.day}</span>
        <span>{usage.daily[usage.daily.length - 1]?.day}</span>
      </div>
    </div>
  );
}

// ─── Plaintext modal ─────────────────────────────────────────────────────

function NewKeySecretModal({
  plaintext,
  keyId,
  rotationOf,
  onClose,
}: {
  plaintext: string;
  keyId: string;
  rotationOf?: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Browsers without clipboard permission — fall back to a manual select.
      const textarea = document.getElementById("apikey-plaintext-textarea") as HTMLTextAreaElement | null;
      textarea?.select();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-key-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-background p-6 shadow-xl">
        <div className="mb-3 flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div>
            <h2 id="new-key-modal-title" className="text-lg font-semibold text-foreground">
              Copiez la clé maintenant
            </h2>
            <p className="text-xs text-muted-foreground">
              Cette clé en clair ne sera plus jamais affichée. Elle est stockée hashée côté serveur.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            <p className="font-semibold">⚠️ Sécurité</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>Transmettez cette clé via un canal sécurisé (gestionnaire de mots de passe).</li>
              <li>Ne la commitez jamais dans Git ni dans un ticket.</li>
              <li>Si elle fuite, faites une rotation immédiatement.</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="apikey-plaintext-textarea"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Clé secrète (id : <code className="font-mono">{keyId}</code>
              {rotationOf && (
                <>
                  {" — "}rotation de <code className="font-mono">{rotationOf}</code>
                </>
              )}
              )
            </label>
            <textarea
              id="apikey-plaintext-textarea"
              readOnly
              value={plaintext}
              rows={3}
              spellCheck={false}
              className="w-full resize-none rounded-md border border-border bg-muted/30 p-2 font-mono text-xs"
              onFocus={(e) => e.target.select()}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-teranga-green" aria-hidden="true" />
                  Copiée
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  Copier
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center rounded-md bg-teranga-gold px-3 py-1.5 text-sm font-medium text-white hover:bg-teranga-gold/90"
            >
              J&apos;ai noté la clé
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
