"use client";

import { useState, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  useRotateApiKey,
} from "@/hooks/use-api-keys";
import { usePlanGating } from "@/hooks/use-plan-gating";
import { useErrorHandler, type ResolvedError } from "@/hooks/use-error-handler";
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

// i18n key-table — maps the ApiKeyScope enum value to the
// `admin.apiKeys.scopes.<slug>` message key. Kept as a pure mapping so
// scope ordering in the UI stays stable across locales.
const SCOPE_I18N_KEYS: { key: ApiKeyScope; i18nKey: string }[] = [
  { key: "event:read", i18nKey: "eventRead" },
  { key: "registration:read_all", i18nKey: "registrationReadAll" },
  { key: "badge:generate", i18nKey: "badgeGenerate" },
  { key: "checkin:scan", i18nKey: "checkinScan" },
];

export default function ApiKeysPage() {
  const t = useTranslations("admin.apiKeys");
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "";
  const { canUse } = usePlanGating();
  const hasApiAccess = canUse("apiAccess");
  const { resolve: resolveError } = useErrorHandler();

  const { data, isLoading, error, refetch } = useApiKeys(orgId, { page: 1, limit: 50 });
  const createMut = useCreateApiKey(orgId);
  const revokeMut = useRevokeApiKey(orgId);
  const rotateMut = useRotateApiKey(orgId);

  const [createOpen, setCreateOpen] = useState(false);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [plaintextDismissed, setPlaintextDismissed] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKey | null>(null);
  // Senior-review / frontend-review remediation: mutation failures use
  // useErrorHandler → InlineErrorBanner inside the relevant surface
  // (create dialog, revoke dialog, row). Never a bare `toast.error()`
  // for blocking submit failures — matches docs/design-system/
  // error-handling.md.
  const [createError, setCreateError] = useState<ResolvedError | null>(null);
  const [revokeError, setRevokeError] = useState<ResolvedError | null>(null);
  const [rotateErrorByKeyId, setRotateErrorByKeyId] = useState<Record<string, ResolvedError>>({});

  const keys = data?.data ?? [];
  const activeCount = useMemo(() => keys.filter((k) => k.status === "active").length, [keys]);

  if (!orgId) {
    return (
      <div className="p-6">
        <EmptyState icon={Key} title={t("noOrgTitle")} description={t("noOrgDescription")} />
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
            <Key className="h-6 w-6" /> {t("heading")}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t("countActive", { count: activeCount })} ·{" "}
            <span className="ml-1">{t("plaintextOnceNote")}</span>
          </p>
        </div>
        {hasApiAccess && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> {t("newKey")}
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
              <h2 className="font-semibold text-amber-900">{t("planRequiredTitle")}</h2>
              <p className="text-sm text-amber-800 mt-1">
                {hasExistingKeys ? t("planRequiredActive") : t("planRequiredUpgrade")}
              </p>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => (window.location.href = "/organization/billing")}
              >
                {t("upgradeCta")}
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
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> {t("emptyCta")}
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
              rotateError={rotateErrorByKeyId[k.id] ?? null}
              onDismissRotateError={() =>
                setRotateErrorByKeyId((prev) => {
                  const next = { ...prev };
                  delete next[k.id];
                  return next;
                })
              }
              onRevoke={() => {
                setRevokeError(null);
                setConfirmRevoke(k);
              }}
              onRotate={async () => {
                setRotateErrorByKeyId((prev) => {
                  const next = { ...prev };
                  delete next[k.id];
                  return next;
                });
                try {
                  const result = await rotateMut.mutateAsync({ apiKeyId: k.id });
                  setPlaintext(result.data.plaintext);
                  setPlaintextDismissed(false);
                } catch (err) {
                  setRotateErrorByKeyId((prev) => ({
                    ...prev,
                    [k.id]: resolveError(err),
                  }));
                  toast.error(t("rotateFailed"));
                }
              }}
            />
          ))}
        </Card>
      )}

      {/* Create dialog */}
      <CreateApiKeyDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setCreateError(null);
        }}
        error={createError}
        onDismissError={() => setCreateError(null)}
        onCreate={async (dto) => {
          setCreateError(null);
          try {
            const result = await createMut.mutateAsync(dto);
            setCreateOpen(false);
            setPlaintext(result.data.plaintext);
            setPlaintextDismissed(false);
          } catch (err) {
            setCreateError(resolveError(err));
            toast.error(t("createFailed"));
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
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setConfirmRevoke(null);
              setRevokeError(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("confirmRevokeTitle")}</DialogTitle>
              <DialogDescription>{t("confirmRevokeDescription")}</DialogDescription>
            </DialogHeader>
            {revokeError && (
              <InlineErrorBanner
                title={revokeError.title}
                description={revokeError.description}
                severity={revokeError.severity === "info" ? "info" : "destructive"}
                onDismiss={() => setRevokeError(null)}
                dismissLabel={t("dismissErrorAria")}
              />
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setConfirmRevoke(null);
                  setRevokeError(null);
                }}
              >
                {t("cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  setRevokeError(null);
                  try {
                    await revokeMut.mutateAsync({
                      apiKeyId: confirmRevoke.id,
                      reason: "manual",
                    });
                    toast.success(t("revokeSuccess"));
                    setConfirmRevoke(null);
                  } catch (err) {
                    setRevokeError(resolveError(err));
                    toast.error(t("revokeFailed"));
                  }
                }}
                disabled={revokeMut.isPending}
              >
                {revokeMut.isPending ? t("revoking") : t("revoke")}
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
  rotateError,
  onRevoke,
  onRotate,
  onDismissRotateError,
}: {
  apiKey: ApiKey;
  allowRotate: boolean;
  rotateError: ResolvedError | null;
  onRevoke: () => void;
  onRotate: () => void;
  onDismissRotateError: () => void;
}) {
  const t = useTranslations("admin.apiKeys");
  return (
    <div className="p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold truncate">{apiKey.name}</span>
          <Badge variant={apiKey.status === "active" ? "success" : "neutral"}>
            {apiKey.status === "active" ? t("active") : t("revoked")}
          </Badge>
          <Badge variant="info">{apiKey.environment}</Badge>
        </div>
        <div className="text-xs font-mono text-muted-foreground mt-1 break-all">
          terk_{apiKey.environment}_{apiKey.hashPrefix}…
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {t("scopeCount", { count: apiKey.scopes.length })} ·{" "}
          {apiKey.lastUsedAt
            ? t("lastUsed", { when: new Date(apiKey.lastUsedAt).toLocaleString("fr-SN") })
            : t("neverUsed")}
        </div>
        {rotateError && (
          <div className="mt-2">
            <InlineErrorBanner
              title={rotateError.title}
              description={rotateError.description}
              severity={rotateError.severity === "info" ? "info" : "destructive"}
              onDismiss={onDismissRotateError}
              dismissLabel={t("dismissErrorAria")}
            />
          </div>
        )}
      </div>
      {apiKey.status === "active" ? (
        <div className="flex gap-2 sm:flex-row flex-wrap">
          {allowRotate && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRotate}
              aria-label={t("rotateAria", { name: apiKey.name })}
            >
              <RefreshCw className="h-4 w-4 mr-2" /> {t("rotateLabel")}
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={onRevoke}
            aria-label={t("revokeAria", { name: apiKey.name })}
          >
            <Ban className="h-4 w-4 mr-2" /> {t("revoke")}
          </Button>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">
          {apiKey.revokedAt
            ? t("revokedOn", { date: new Date(apiKey.revokedAt).toLocaleDateString("fr-SN") })
            : t("revoked")}
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
  error,
  onDismissError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (dto: { name: string; scopes: ApiKeyScope[]; environment: "live" | "test" }) => void;
  isPending: boolean;
  error: ResolvedError | null;
  onDismissError: () => void;
}) {
  const t = useTranslations("admin.apiKeys");
  const tScopes = useTranslations("admin.apiKeys.scopes");
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<ApiKeyScope>>(new Set());
  const [environment, setEnvironment] = useState<"live" | "test">("live");
  // Frontend-review remediation: only show the "select at least one
  // scope" validation after the user attempts to submit. Showing it
  // on first render would greet a brand-new user with a red banner
  // for no reason.
  const [submitted, setSubmitted] = useState(false);

  const canSubmit = name.trim().length > 0 && scopes.size > 0 && !isPending;
  const showScopeError = submitted && scopes.size === 0;

  const reset = () => {
    setName("");
    setScopes(new Set());
    setEnvironment("live");
    setSubmitted(false);
  };

  const submit = () => {
    setSubmitted(true);
    if (!canSubmit) return;
    onCreate({
      name: name.trim(),
      scopes: Array.from(scopes),
      environment,
    });
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
          <DialogTitle>{t("createTitle")}</DialogTitle>
          <DialogDescription>{t("createDescription")}</DialogDescription>
        </DialogHeader>

        {/* Frontend-review remediation: wrap the form in a real <form>
            so pressing Enter in the Nom field submits. Previously the
            Enter key did nothing — a usability defect. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-4"
          noValidate
        >
          {error && (
            <InlineErrorBanner
              title={error.title}
              description={error.description}
              severity={error.severity === "info" ? "info" : "destructive"}
              onDismiss={onDismissError}
              dismissLabel={t("dismissErrorAria")}
            />
          )}

          <div>
            <label className="text-sm font-medium" htmlFor="api-key-name">
              {t("nameLabel")}
            </label>
            <Input
              id="api-key-name"
              placeholder={t("namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
              autoComplete="off"
            />
          </div>

          <div>
            <p className="text-sm font-medium" id="api-key-env-label">
              {t("environmentLabel")}
            </p>
            <div className="flex gap-2 mt-1" role="radiogroup" aria-labelledby="api-key-env-label">
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
                  {env === "live" ? t("environmentProd") : t("environmentTest")}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium" id="api-key-scopes-label">
              {t("scopesLabel")}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{t("scopesHint")}</p>
            <div className="space-y-2 mt-1" role="group" aria-labelledby="api-key-scopes-label">
              {SCOPE_I18N_KEYS.map(({ key, i18nKey }) => {
                const selected = scopes.has(key);
                return (
                  <label
                    key={key}
                    className="flex items-start gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        const next = new Set(scopes);
                        if (e.target.checked) next.add(key);
                        else next.delete(key);
                        setScopes(next);
                      }}
                      aria-describedby={`scope-hint-${key}`}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="font-medium text-sm">{tScopes(`${i18nKey}.label`)}</div>
                      <div className="text-xs text-muted-foreground" id={`scope-hint-${key}`}>
                        {tScopes(`${i18nKey}.hint`)}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            {showScopeError && (
              <p className="text-xs text-destructive mt-2" role="alert">
                {t("scopeRequired")}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isPending ? t("creating") : t("create")}
            </Button>
          </DialogFooter>
        </form>
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
  const t = useTranslations("admin.apiKeys");
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  async function copyToClipboard() {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
      toast.success(t("copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Safari private-mode / no-clipboard-permission fallback.
      // Select-all the <code> so the user can Cmd+C / Ctrl+C.
      try {
        const range = document.createRange();
        range.selectNodeContents(codeRef.current!);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        toast.info(t("copyFallbackSelected"));
      } catch {
        toast.error(t("copyFailed"));
      }
    }
  }

  return (
    <Dialog open={!!plaintext} onOpenChange={(o) => !o && acknowledged && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {t("revealTitle")}
          </DialogTitle>
          <DialogDescription>{t("revealDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2 items-center bg-gray-50 border rounded p-3">
            <code
              ref={codeRef}
              className="flex-1 font-mono text-xs break-all select-all"
              aria-label={t("plaintextAria")}
            >
              {plaintext}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={copyToClipboard}
              aria-label={t("copyAria")}
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
            <span>{t("acknowledgement")}</span>
          </label>
        </div>

        <DialogFooter>
          <Button onClick={onClose} disabled={!acknowledged}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
