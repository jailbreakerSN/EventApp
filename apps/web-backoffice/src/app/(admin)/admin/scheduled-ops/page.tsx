"use client";

/**
 * Sprint-4 T3.2 closure — Scheduled admin operations page.
 *
 * CRUD over recurring runs of registered admin jobs. Each row binds:
 *   - a registered job key (validated server-side against the
 *     job registry)
 *   - a frozen JSON input
 *   - a 5-field cron expression + IANA timezone
 *
 * The actual triggering happens out-of-process — see
 * `docs/runbooks/scheduled-ops.md`.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Card,
  CardContent,
  SectionHeader,
  Button,
  Switch,
  Badge,
  Skeleton,
  InlineErrorBanner,
} from "@teranga/shared-ui";
import { Plus, Trash2, Clock, Play } from "lucide-react";
import type { ScheduledAdminOp } from "@teranga/shared-types";
import { api } from "@/lib/api-client";
import { useErrorHandler } from "@/hooks/use-error-handler";

interface ApiResponse<T> {
  success: true;
  data: T;
}

function fmtIso(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-SN", {
    timeZone: "Africa/Dakar",
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function AdminScheduledOpsPage() {
  const { resolve } = useErrorHandler();
  const [ops, setOps] = useState<ScheduledAdminOp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get<ApiResponse<ScheduledAdminOp[]>>("/v1/admin/scheduled-ops");
      setOps(res.data);
      setError(null);
    } catch (err) {
      setError(resolve(err).description);
    }
  }, [resolve]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const toggleEnabled = async (op: ScheduledAdminOp) => {
    try {
      await api.patch(`/v1/admin/scheduled-ops/${encodeURIComponent(op.id)}`, {
        enabled: !op.enabled,
      });
      await fetchData();
    } catch (err) {
      setError(resolve(err).description);
    }
  };

  const handleDelete = async (op: ScheduledAdminOp) => {
    if (!window.confirm(`Supprimer la planification « ${op.name} » ?`)) return;
    try {
      await api.delete(`/v1/admin/scheduled-ops/${encodeURIComponent(op.id)}`);
      await fetchData();
    } catch (err) {
      setError(resolve(err).description);
    }
  };

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Administration</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Opérations planifiées</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <SectionHeader
        kicker="— Platform"
        title="Opérations planifiées"
        subtitle="Déclenchements récurrents des jobs admin enregistrés. Le trigger Cloud Functions tourne toutes les 5 minutes — chaque op dont nextRunAt est dépassé est dispatchée vers le job runner standard."
        action={
          <Button onClick={() => setShowCreate(true)} disabled={showCreate}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            Nouvelle opération
          </Button>
        }
      />

      {error && (
        <InlineErrorBanner
          severity="destructive"
          kicker="— Erreur"
          title="Une erreur est survenue"
          description={error}
          actions={[{ label: "Réessayer", onClick: () => void fetchData() }]}
        />
      )}

      {showCreate && (
        <CreateOpForm
          onCancel={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await fetchData();
          }}
          onError={(msg) => setError(msg)}
        />
      )}

      {!ops && !error && (
        <div className="space-y-2">
          <Skeleton variant="text" className="h-16 w-full" />
          <Skeleton variant="text" className="h-16 w-full" />
        </div>
      )}

      {ops && ops.length === 0 && !showCreate && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <Clock className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <div className="text-sm font-semibold text-foreground">
              Aucune opération planifiée
            </div>
            <div className="max-w-md text-xs text-muted-foreground">
              Créez votre première planification pour automatiser un job admin
              récurrent (ex. archive automatique des événements terminés depuis
              90 jours, rappel de paiement à J-7).
            </div>
          </CardContent>
        </Card>
      )}

      {ops && ops.length > 0 && (
        <div className="divide-y divide-border rounded-xl border border-border">
          {ops.map((op) => (
            <div key={op.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{op.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {op.jobKey}
                    </Badge>
                    <Badge variant={op.enabled ? "success" : "neutral"}>
                      {op.enabled ? "Active" : "Désactivée"}
                    </Badge>
                    {op.lastRunStatus && (
                      <Badge
                        variant={
                          op.lastRunStatus === "succeeded"
                            ? "success"
                            : op.lastRunStatus === "failed"
                              ? "destructive"
                              : "neutral"
                        }
                        className="text-[10px]"
                      >
                        Dernier : {op.lastRunStatus}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    <span>
                      Cron <code className="font-mono">{op.cron}</code> ({op.timezone})
                    </span>
                    <span>·</span>
                    <span>Prochain : {fmtIso(op.nextRunAt)}</span>
                    {op.lastRunAt && (
                      <>
                        <span>·</span>
                        <span>Dernier : {fmtIso(op.lastRunAt)}</span>
                      </>
                    )}
                  </div>
                  {Object.keys(op.jobInput ?? {}).length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground">
                        Voir les paramètres
                      </summary>
                      <pre className="mt-1 rounded-md border border-border bg-muted/20 p-2 text-[11px]">
                        {JSON.stringify(op.jobInput, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Switch
                    checked={op.enabled}
                    onCheckedChange={() => void toggleEnabled(op)}
                    label={op.enabled ? "Désactiver" : "Activer"}
                  />
                  <button
                    type="button"
                    onClick={() => void handleDelete(op)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-background px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:hover:bg-red-950/30"
                    aria-label={`Supprimer ${op.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Supprimer
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-md border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
        <p className="font-semibold text-foreground">Cron — pense-bête</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          <li>
            <code className="font-mono">0 2 * * *</code> — tous les jours à 02:00
          </li>
          <li>
            <code className="font-mono">*/15 * * * *</code> — toutes les 15 minutes
          </li>
          <li>
            <code className="font-mono">0 9 * * 1</code> — chaque lundi à 09:00
          </li>
          <li>
            <code className="font-mono">0 0 1 * *</code> — le 1er de chaque mois à minuit
          </li>
        </ul>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Play className="h-3 w-3" aria-hidden="true" />
        <span>
          Voir l&apos;historique des runs sur <code>/admin/jobs</code>.
        </span>
      </div>
    </div>
  );
}

function CreateOpForm({
  onCancel,
  onCreated,
  onError,
}: {
  onCancel: () => void;
  onCreated: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const { resolve } = useErrorHandler();
  const [name, setName] = useState("");
  const [jobKey, setJobKey] = useState("ping");
  const [cron, setCron] = useState("0 2 * * *");
  const [timezone, setTimezone] = useState("Africa/Dakar");
  const [jobInputRaw, setJobInputRaw] = useState("{}");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    let jobInput: Record<string, unknown> = {};
    try {
      jobInput = JSON.parse(jobInputRaw);
    } catch {
      onError("Le champ jobInput doit contenir un JSON valide (ex: {} ou {\"foo\": \"bar\"})");
      setSubmitting(false);
      return;
    }
    try {
      await api.post("/v1/admin/scheduled-ops", {
        name,
        jobKey,
        cron,
        timezone,
        jobInput,
      });
      await onCreated();
    } catch (err) {
      onError(resolve(err).description);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Nouvelle opération planifiée
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">Nom</span>
              <input
                type="text"
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Auto-archive — events terminés > 90j"
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">Job key</span>
              <input
                type="text"
                required
                maxLength={80}
                value={jobKey}
                onChange={(e) => setJobKey(e.target.value)}
                placeholder="ping / prune-expired-invites / firestore-backup"
                className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">Cron (5 champs)</span>
              <input
                type="text"
                required
                maxLength={80}
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="0 2 * * *"
                className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">Timezone (IANA)</span>
              <input
                type="text"
                maxLength={80}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="Africa/Dakar"
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
              />
            </label>
          </div>

          <label className="space-y-1 text-sm">
            <span className="font-medium text-foreground">jobInput (JSON)</span>
            <textarea
              rows={4}
              value={jobInputRaw}
              onChange={(e) => setJobInputRaw(e.target.value)}
              className="w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
            />
          </label>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={onCancel} disabled={submitting}>
              Annuler
            </Button>
            <Button type="submit" disabled={submitting || !name || !jobKey || !cron}>
              {submitting ? "Création…" : "Créer"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
