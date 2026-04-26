"use client";

/**
 * Organizer overhaul — Phase O8.
 *
 * Floor-ops incident log. Two responsibilities in one component:
 *
 *   1. **List + filter** — show incidents for the event, filterable by
 *      status (open / triaged / in_progress / resolved). Most recent
 *      first. Severity color-codes the row. Click → expands to assign
 *      / change status / write resolution note.
 *   2. **Create form** — small inline form (kind, severity, location,
 *      description) so a staff member can log a signalement without
 *      leaving the live page.
 *
 * Design decisions:
 *  - Status filter is local UI state (not URL). The live page is
 *    transient — the operator stays here for the duration of the
 *    event, no need to deep-link to a filter.
 *  - Optimistic UX: on submit, the form clears immediately and the
 *    list query revalidates via React Query's onSuccess invalidation.
 *  - Keyboard: ⌘/Ctrl+Enter submits the create form (operator's
 *    hands stay on the keyboard during a hot incident).
 *  - Severity → border-left color; status → small pill at the right.
 *  - Empty state ("Aucun incident — RAS") is positive framing because
 *    the live page is mostly green-ops, not crisis-ops.
 */

import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { AlertTriangle, CheckCircle2, Clock, PlusCircle, Send, ShieldAlert } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  FormField,
  InlineErrorBanner,
  Select,
  Textarea,
  Input,
  Badge,
} from "@teranga/shared-ui";
import { useErrorHandler, type ResolvedError } from "@/hooks/use-error-handler";
import { cn } from "@/lib/utils";
import { useIncidents, useCreateIncident, useUpdateIncident } from "@/hooks/use-live-ops";
import { formatElapsed } from "./helpers";

export { formatElapsed };
import type {
  CreateIncidentDto,
  Incident,
  IncidentKind,
  IncidentSeverity,
  IncidentStatus,
} from "@teranga/shared-types";

// ─── Static labels ────────────────────────────────────────────────────────

const KIND_LABEL: Record<IncidentKind, string> = {
  medical: "Médical",
  theft: "Vol / objet perdu",
  latecomer: "Retardataire / litige billet",
  technical: "Technique",
  logistics: "Logistique",
  security: "Sécurité",
  other: "Autre",
};

const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  low: "Faible",
  medium: "Moyenne",
  high: "Élevée",
  critical: "Critique",
};

const SEVERITY_BORDER: Record<IncidentSeverity, string> = {
  low: "border-l-slate-400",
  medium: "border-l-amber-400",
  high: "border-l-orange-500",
  critical: "border-l-red-600",
};

const STATUS_LABEL: Record<IncidentStatus, string> = {
  open: "Ouvert",
  triaged: "Trié",
  in_progress: "En cours",
  resolved: "Résolu",
};

const STATUS_BADGE: Record<IncidentStatus, "default" | "secondary" | "destructive" | "outline"> = {
  open: "destructive",
  triaged: "default",
  in_progress: "default",
  resolved: "secondary",
};

const STATUS_FILTERS: ReadonlyArray<{ id: "all" | IncidentStatus; label: string }> = [
  { id: "all", label: "Tous" },
  { id: "open", label: "Ouverts" },
  { id: "in_progress", label: "En cours" },
  { id: "resolved", label: "Résolus" },
];

// ─── Component ────────────────────────────────────────────────────────────

export interface IncidentLogProps {
  eventId: string;
  /** Logged-in user uid — used to default `assignedTo = me`. */
  currentUserId?: string;
  className?: string;
}

export function IncidentLog({ eventId, currentUserId, className }: IncidentLogProps) {
  const [filter, setFilter] = useState<"all" | IncidentStatus>("all");
  const status = filter === "all" ? undefined : filter;
  const { data: incidents, isLoading } = useIncidents(eventId, status);

  return (
    <Card className={className}>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-orange-500" aria-hidden="true" />
            Incidents
          </h2>
          <div className="flex gap-1 text-xs" role="tablist" aria-label="Filtre par statut">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "px-2.5 py-1 rounded-full motion-safe:transition-colors",
                  filter === f.id
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <CreateIncidentForm eventId={eventId} />

        {/* List */}
        {isLoading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Chargement…</p>
        ) : !incidents || incidents.length === 0 ? (
          <div className="rounded-md bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-6 text-center text-sm text-foreground">
            <CheckCircle2 className="h-5 w-5 mx-auto mb-1 text-emerald-600 dark:text-emerald-400" />
            Aucun incident — RAS pour le moment.
          </div>
        ) : (
          <ul className="space-y-2">
            {incidents.map((incident) => (
              <IncidentRow
                key={incident.id}
                incident={incident}
                eventId={eventId}
                currentUserId={currentUserId}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Create form ──────────────────────────────────────────────────────────

function CreateIncidentForm({ eventId }: { eventId: string }) {
  const [kind, setKind] = useState<IncidentKind>("logistics");
  const [severity, setSeverity] = useState<IncidentSeverity>("medium");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const { resolve: resolveError } = useErrorHandler();
  const [error, setError] = useState<ResolvedError | null>(null);
  const create = useCreateIncident(eventId);

  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    setValidationError(null);
    if (description.trim().length === 0) {
      setValidationError("La description est requise.");
      return;
    }
    const dto: CreateIncidentDto = {
      kind,
      severity,
      description: description.trim(),
      ...(location.trim() ? { location: location.trim() } : {}),
    };
    try {
      await create.mutateAsync(dto);
      setDescription("");
      setLocation("");
      setSeverity("medium");
      setKind("logistics");
    } catch (err) {
      setError(resolveError(err));
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <form onSubmit={submit} className="rounded-md border border-border bg-muted/20 p-3 space-y-2.5">
      {error && (
        <InlineErrorBanner
          title={error.title}
          description={error.description}
          onDismiss={() => setError(null)}
          dismissLabel="Fermer"
        />
      )}
      {validationError && (
        <InlineErrorBanner
          title="Description manquante"
          description={validationError}
          onDismiss={() => setValidationError(null)}
          dismissLabel="Fermer"
        />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <FormField label="Type" htmlFor="incident-kind">
          <Select
            id="incident-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as IncidentKind)}
          >
            {(Object.keys(KIND_LABEL) as IncidentKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Gravité" htmlFor="incident-severity">
          <Select
            id="incident-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
          >
            {(Object.keys(SEVERITY_LABEL) as IncidentSeverity[]).map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABEL[s]}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Localisation" htmlFor="incident-location">
          <Input
            id="incident-location"
            placeholder="Hall A — entrée 3"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={200}
          />
        </FormField>
      </div>

      <FormField label="Description" htmlFor="incident-description">
        <Textarea
          id="incident-description"
          placeholder="Décrivez l'incident…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={handleKey}
          rows={2}
          maxLength={2000}
        />
      </FormField>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">⌘/Ctrl + Entrée pour envoyer</p>
        <Button type="submit" size="sm" disabled={create.isPending}>
          <PlusCircle className="h-4 w-4 mr-1.5" aria-hidden="true" />
          {create.isPending ? "Envoi…" : "Logger l'incident"}
        </Button>
      </div>
    </form>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────

function IncidentRow({
  incident,
  eventId,
  currentUserId,
}: {
  incident: Incident;
  eventId: string;
  currentUserId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const update = useUpdateIncident(eventId);
  const { resolve: resolveError } = useErrorHandler();
  const [error, setError] = useState<ResolvedError | null>(null);
  const [resolutionNote, setResolutionNote] = useState(incident.resolutionNote ?? "");

  const elapsed = useMemo(() => formatElapsed(incident.createdAt), [incident.createdAt]);

  const handleStatusChange = async (next: IncidentStatus) => {
    setError(null);
    try {
      await update.mutateAsync({
        incidentId: incident.id,
        dto: {
          status: next,
          ...(next === "resolved" && resolutionNote.trim()
            ? { resolutionNote: resolutionNote.trim() }
            : {}),
          ...(next === "triaged" && currentUserId && !incident.assignedTo
            ? { assignedTo: currentUserId }
            : {}),
        },
      });
    } catch (err) {
      setError(resolveError(err));
    }
  };

  return (
    <li
      className={cn(
        "rounded-md border border-border bg-background border-l-4",
        SEVERITY_BORDER[incident.severity],
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left p-3 flex items-start gap-3 hover:bg-accent/30 motion-safe:transition-colors"
        aria-expanded={expanded}
      >
        <AlertTriangle
          className={cn(
            "h-4 w-4 mt-0.5 shrink-0",
            incident.severity === "critical"
              ? "text-red-600"
              : incident.severity === "high"
                ? "text-orange-500"
                : "text-amber-500",
          )}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{KIND_LABEL[incident.kind]}</span>
            <span className="text-[11px] text-muted-foreground">
              {SEVERITY_LABEL[incident.severity]}
            </span>
            {incident.location && (
              <span className="text-[11px] text-muted-foreground">· {incident.location}</span>
            )}
          </div>
          <p className="text-xs text-foreground/80 mt-0.5 line-clamp-2">{incident.description}</p>
          <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {elapsed}
          </p>
        </div>
        <Badge variant={STATUS_BADGE[incident.status]} className="shrink-0">
          {STATUS_LABEL[incident.status]}
        </Badge>
      </button>

      {expanded && (
        <div className="border-t border-border p-3 bg-muted/30 space-y-2.5">
          {error && (
            <InlineErrorBanner
              title={error.title}
              description={error.description}
              onDismiss={() => setError(null)}
              dismissLabel="Fermer"
            />
          )}

          {incident.status !== "resolved" && (
            <FormField label="Note de résolution (optionnelle)" htmlFor={`note-${incident.id}`}>
              <Textarea
                id={`note-${incident.id}`}
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Ce qui a été fait pour clore l'incident…"
              />
            </FormField>
          )}
          {incident.status === "resolved" && incident.resolutionNote && (
            <div className="text-xs">
              <span className="font-medium text-muted-foreground">Note : </span>
              <span className="text-foreground">{incident.resolutionNote}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {incident.status === "open" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleStatusChange("triaged")}
                disabled={update.isPending}
              >
                Prendre en charge
              </Button>
            )}
            {(incident.status === "open" || incident.status === "triaged") && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleStatusChange("in_progress")}
                disabled={update.isPending}
              >
                Marquer en cours
              </Button>
            )}
            {incident.status !== "resolved" && (
              <Button
                size="sm"
                onClick={() => handleStatusChange("resolved")}
                disabled={update.isPending}
              >
                <Send className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                Clore l&apos;incident
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
