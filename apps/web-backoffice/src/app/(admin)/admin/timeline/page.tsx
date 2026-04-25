"use client";

/**
 * Sprint-4 T3.1 closure — time-travel timeline for any admin resource.
 *
 * Generic admin surface invoked via a query string:
 *
 *   /admin/timeline?resourceType=event&resourceId=evt-123
 *   /admin/timeline?resourceType=organization&resourceId=org-1&atIso=2026-04-25T12:00:00Z
 *
 * Renders the audit log for the (resourceType, resourceId) pair as a
 * chronological vertical timeline with:
 *   - one node per audit row (action badge + actor + timestamp)
 *   - an expandable `<AuditDiffView>` per row (re-uses Sprint-1 B5)
 *   - a date scrubber that visually splits the timeline into
 *     "before / after" relative to an `atIso` cursor
 *   - a coverage strip indicating whether the requested date is
 *     within the audit retention window
 *
 * Honest limit: full state reconstruction requires every mutating
 * audit row to carry `details.before/after`. Today many emitters
 * record only `details: {}` or `details.changes: string[]`. The UI
 * surfaces `reconstructable: false` rows transparently rather than
 * faking authority.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
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
  Skeleton,
  Badge,
  InlineErrorBanner,
} from "@teranga/shared-ui";
import { Clock, History, ArrowRight } from "lucide-react";
import { eventsApi as _eventsApi } from "@/lib/api-client"; // typing pull-through
import { adminApi } from "@/lib/api-client";
import { useErrorHandler } from "@/hooks/use-error-handler";
import { AuditDiffView } from "@/components/admin/audit-diff-view";

// Suppress unused — adminApi is the canonical entry point but we
// reference eventsApi only for the build-time check that the
// shared types still resolve. (kept silent.)
void _eventsApi;

interface TimelineSnapshot {
  resourceType: string;
  resourceId: string;
  atIso: string | null;
  rows: Array<{
    id: string;
    action: string;
    actorId: string;
    actorRole: string | null;
    timestamp: string;
    details: Record<string, unknown> | null;
    reconstructable: boolean;
  }>;
  coverage: {
    oldestRowTimestamp: string | null;
    newestRowTimestamp: string | null;
    requestedDateInWindow: boolean | null;
  };
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("fr-SN", {
    timeZone: "Africa/Dakar",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function AdminTimelinePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { resolve } = useErrorHandler();

  const resourceType = searchParams?.get("resourceType") ?? "";
  const resourceId = searchParams?.get("resourceId") ?? "";
  const atIso = searchParams?.get("atIso") ?? null;

  const [data, setData] = useState<TimelineSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!resourceType || !resourceId) {
      setError(
        "URL invalide : `resourceType` et `resourceId` sont requis (ex: /admin/timeline?resourceType=event&resourceId=evt-123).",
      );
      return;
    }
    try {
      const res = await adminApi.getResourceTimeline({
        resourceType,
        resourceId,
        atIso: atIso ?? undefined,
      });
      setData(res.data);
      setError(null);
    } catch (err) {
      setError(resolve(err).description);
    }
  }, [resourceType, resourceId, atIso, resolve]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const setAt = (newAtIso: string | null) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (newAtIso) {
      params.set("atIso", newAtIso);
    } else {
      params.delete("atIso");
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
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
            <BreadcrumbPage>Chronologie</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <SectionHeader
        kicker="— Forensique"
        title={
          resourceType && resourceId
            ? `${resourceType} ${resourceId}`
            : "Time-travel — audit chronologique"
        }
        subtitle="Reconstitution chronologique d'une ressource à partir des entrées d'audit. Les lignes marquées « non reconstituable » signifient que l'événement initial n'a pas capturé l'état avant/après — la ligne est conservée mais le diff exact n'est pas affiché."
      />

      {error && (
        <InlineErrorBanner
          severity="destructive"
          kicker="— Erreur"
          title="Impossible de charger la chronologie"
          description={error}
          actions={[{ label: "Réessayer", onClick: () => void fetchData() }]}
        />
      )}

      {!data && !error && (
        <div className="space-y-2">
          <Skeleton variant="text" className="h-12 w-full" />
          <Skeleton variant="text" className="h-12 w-full" />
          <Skeleton variant="text" className="h-12 w-full" />
        </div>
      )}

      {data && (
        <>
          {/* Coverage strip */}
          <Card>
            <CardContent className="space-y-2 p-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span className="text-muted-foreground">Couverture audit :</span>
                  <span>
                    {data.coverage.oldestRowTimestamp
                      ? `${fmt(data.coverage.oldestRowTimestamp)} → ${fmt(data.coverage.newestRowTimestamp ?? data.coverage.oldestRowTimestamp)}`
                      : "Aucune entrée d'audit pour cette ressource."}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {data.rows.length} ligne{data.rows.length > 1 ? "s" : ""}
                </span>
              </div>
              {data.atIso && data.coverage.requestedDateInWindow === false && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                  ⚠️ La date demandée ({fmt(data.atIso)}) est antérieure à la première ligne
                  d&apos;audit conservée — l&apos;état à cette date ne peut pas être prouvé
                  par le système.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cursor controls */}
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="timeline-cursor"
              className="text-xs font-medium text-muted-foreground"
            >
              Curseur temporel :
            </label>
            <input
              id="timeline-cursor"
              type="datetime-local"
              value={atIso ? atIso.slice(0, 16) : ""}
              onChange={(e) => setAt(e.target.value ? `${e.target.value}:00.000Z` : null)}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            />
            {atIso && (
              <button
                type="button"
                onClick={() => setAt(null)}
                className="text-xs text-teranga-gold hover:underline"
              >
                Désactiver
              </button>
            )}
          </div>

          {/* Timeline */}
          {data.rows.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
                <Clock className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <div className="text-sm font-semibold text-foreground">
                  Aucune entrée d&apos;audit
                </div>
                <div className="max-w-sm text-xs text-muted-foreground">
                  Cette ressource n&apos;a généré aucun événement audit. Soit elle vient
                  d&apos;être créée, soit elle est antérieure à l&apos;activation du
                  système d&apos;audit, soit son <code>resourceType</code> ne correspond
                  pas à ce qu&apos;on indexe.
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="relative ml-4">
              {/* Vertical line */}
              <div
                className="absolute left-0 top-0 h-full w-0.5 bg-border"
                aria-hidden="true"
              />
              <ol className="space-y-4">
                {data.rows.map((row) => {
                  const isPast = atIso ? row.timestamp < atIso : true;
                  const isCursor = atIso && row.timestamp >= atIso;
                  const expanded = expandedId === row.id;
                  return (
                    <li key={row.id} className="relative pl-6">
                      {/* Bullet */}
                      <span
                        className={
                          isPast
                            ? "absolute -left-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-teranga-gold bg-background"
                            : "absolute -left-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-border bg-background"
                        }
                        aria-hidden="true"
                      />
                      <Card>
                        <CardContent className="space-y-2 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge
                                variant={isCursor ? "info" : "outline"}
                                className="text-[10px]"
                              >
                                {row.action}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                par <code className="font-mono">{row.actorId}</code>
                                {row.actorRole && ` (${row.actorRole})`}
                              </span>
                              {!row.reconstructable && (
                                <Badge variant="neutral" className="text-[10px]">
                                  Non reconstituable
                                </Badge>
                              )}
                            </div>
                            <time
                              dateTime={row.timestamp}
                              className="shrink-0 text-[11px] text-muted-foreground"
                            >
                              {fmt(row.timestamp)}
                            </time>
                          </div>
                          {row.details && (
                            <details
                              open={expanded}
                              onToggle={(e) => {
                                if ((e.target as HTMLDetailsElement).open) {
                                  setExpandedId(row.id);
                                } else if (expandedId === row.id) {
                                  setExpandedId(null);
                                }
                              }}
                            >
                              <summary className="cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground">
                                Voir le diff
                              </summary>
                              <div className="mt-2">
                                <AuditDiffView details={row.details} action={row.action} />
                              </div>
                            </details>
                          )}
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Link
              href={`/admin/audit?resourceType=${encodeURIComponent(data.resourceType)}&resourceId=${encodeURIComponent(data.resourceId)}`}
              className="inline-flex items-center gap-1 text-teranga-gold hover:underline"
            >
              Ouvrir dans l&apos;audit log <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
