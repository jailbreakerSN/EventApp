"use client";

/**
 * Phase 6 — Platform feature flags UI.
 *
 * Minimal working surface: list every flag stored in Firestore's
 * `featureFlags` collection, allow toggling on/off + editing the
 * rollout percentage (0..100) and description. A save action
 * writes via PUT /v1/admin/feature-flags/:key.
 *
 * Scope is deliberately minimal — this commit delivers the foundation
 * (CRUD + audit log + UI), future commits layer targeting (per-org,
 * per-user cohorts) once we have a real need. Good SaaS practice: ship
 * flags as a binary + rollout %, add segmentation when the use-case
 * appears. YAGNI applies.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  Card,
  CardContent,
  Input,
  Switch,
  SectionHeader,
  Skeleton,
} from "@teranga/shared-ui";
import { Flag, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { useErrorHandler } from "@/hooks/use-error-handler";

interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string | null;
  rolloutPercent: number;
  updatedAt?: string;
  updatedBy?: string;
}

export default function AdminFeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const { resolve } = useErrorHandler();

  // Draft state for editing fields locally before PUT.
  const [drafts, setDrafts] = useState<Record<string, Partial<FeatureFlag>>>({});
  const [newKey, setNewKey] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const fetchFlags = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; data: FeatureFlag[] }>(
        "/v1/admin/feature-flags",
      );
      setFlags(res.data);
    } catch (err) {
      toast.error(resolve(err).description);
    }
  }, [resolve]);

  useEffect(() => {
    void fetchFlags();
  }, [fetchFlags]);

  const saveFlag = useCallback(
    async (key: string, next: Partial<FeatureFlag>) => {
      const current = flags?.find((f) => f.key === key);
      // Phase E closure — confirm dialog on "enabled → disabled" flip.
      // A disabled flag in production is indistinguishable from an
      // outage for users on the code path gated behind it; make the
      // action deliberate.
      if (
        current?.enabled === true &&
        next.enabled === false &&
        typeof window !== "undefined" &&
        !window.confirm(
          `Désactiver le feature flag "${key}" ?\n\n` +
            "Toute fonctionnalité gated derrière ce flag cessera immédiatement. " +
            "Assurez-vous que c'est intentionnel avant de confirmer.",
        )
      ) {
        return;
      }
      setSaving((prev) => ({ ...prev, [key]: true }));
      try {
        const body = {
          enabled: next.enabled ?? current?.enabled ?? false,
          description: next.description ?? current?.description ?? undefined,
          rolloutPercent: next.rolloutPercent ?? current?.rolloutPercent ?? 100,
        };
        await api.put<{ success: boolean; data: FeatureFlag }>(
          `/v1/admin/feature-flags/${encodeURIComponent(key)}`,
          body,
        );
        toast.success(`Feature flag ${key} enregistré.`);
        setDrafts((prev) => {
          const copy = { ...prev };
          delete copy[key];
          return copy;
        });
        await fetchFlags();
      } catch (err) {
        toast.error(resolve(err).description);
      } finally {
        setSaving((prev) => ({ ...prev, [key]: false }));
      }
    },
    [flags, fetchFlags, resolve],
  );

  const createFlag = useCallback(async () => {
    const key = newKey.trim();
    if (!/^[a-z0-9-_.]+$/.test(key)) {
      toast.error("Clé invalide. Lettres minuscules, chiffres, tirets seulement.");
      return;
    }
    await saveFlag(key, { enabled: false, description: newDescription, rolloutPercent: 0 });
    setNewKey("");
    setNewDescription("");
  }, [newKey, newDescription, saveFlag]);

  const sortedFlags = useMemo(
    () => (flags ? [...flags].sort((a, b) => a.key.localeCompare(b.key)) : null),
    [flags],
  );

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin">Administration</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Feature flags</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <SectionHeader
        kicker="— Platform"
        title="Feature flags"
        subtitle="Activez, désactivez ou déployez progressivement une fonctionnalité sans redéploiement de code."
      />

      {/* Create form */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Nouvelle clé
            </label>
            <Input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="new-feature-x"
              aria-label="Nouvelle clé de feature flag"
            />
          </div>
          <div className="flex-1 min-w-[240px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Description
            </label>
            <Input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Brève description du flag"
              aria-label="Description"
            />
          </div>
          <Button onClick={() => void createFlag()} disabled={!newKey.trim()} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Créer (désactivé)
          </Button>
        </CardContent>
      </Card>

      {/* Flags list */}
      {sortedFlags === null && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} variant="text" className="h-16 w-full" />
          ))}
        </div>
      )}

      {sortedFlags && sortedFlags.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Flag className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <div className="text-sm font-semibold text-foreground">Aucun feature flag</div>
            <div className="max-w-sm text-xs text-muted-foreground">
              Créez votre premier flag via le formulaire ci-dessus. Les flags sont lus à la demande
              par l'API et le frontend via le hook <code>useFeatureFlag()</code> (Phase 6.1).
            </div>
          </CardContent>
        </Card>
      )}

      {sortedFlags && sortedFlags.length > 0 && (
        <div className="space-y-2">
          {sortedFlags.map((flag) => {
            const draft = drafts[flag.key] ?? {};
            const isDraft = Object.keys(draft).length > 0;
            const merged = { ...flag, ...draft };
            return (
              <Card key={flag.key}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <code className="font-mono text-sm font-semibold text-foreground">
                          {flag.key}
                        </code>
                        {merged.enabled ? (
                          <Badge variant="success" className="text-[10px]">
                            On
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            Off
                          </Badge>
                        )}
                        {merged.rolloutPercent < 100 && merged.enabled && (
                          <Badge variant="info" className="text-[10px]">
                            {merged.rolloutPercent}% rollout
                          </Badge>
                        )}
                      </div>
                      {merged.description && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {merged.description}
                        </div>
                      )}
                      {flag.updatedAt && (
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          Maj le {new Date(flag.updatedAt).toLocaleString("fr-FR")}
                          {flag.updatedBy ? ` par ${flag.updatedBy}` : null}
                        </div>
                      )}
                    </div>
                    <Switch
                      checked={merged.enabled}
                      onCheckedChange={(next) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [flag.key]: { ...prev[flag.key], enabled: next },
                        }))
                      }
                      label={`Activer ${flag.key}`}
                    />
                  </div>

                  <div className="flex flex-wrap items-end gap-3">
                    <div className="w-40">
                      <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                        Rollout %
                      </label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={merged.rolloutPercent}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [flag.key]: {
                              ...prev[flag.key],
                              rolloutPercent: Math.max(
                                0,
                                Math.min(100, Number(e.target.value) || 0),
                              ),
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="min-w-[200px] flex-1">
                      <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                        Description
                      </label>
                      <Input
                        value={merged.description ?? ""}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [flag.key]: { ...prev[flag.key], description: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <Button
                      size="sm"
                      variant={isDraft ? "default" : "outline"}
                      disabled={!isDraft || Boolean(saving[flag.key])}
                      onClick={() => void saveFlag(flag.key, draft)}
                      className="gap-1.5"
                    >
                      <Save className="h-3.5 w-3.5" aria-hidden="true" />
                      {saving[flag.key] ? "Enregistrement..." : "Enregistrer"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
