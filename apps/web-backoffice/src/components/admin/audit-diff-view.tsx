"use client";

/**
 * Sprint-1 B5 closure — Visual diff view for admin audit rows.
 *
 * Audit rows captured by the listener layer carry a `details` payload
 * whose shape depends on the action. We surface that payload as a
 * human-readable diff, falling back to a JSON view when the shape
 * isn't recognised.
 *
 * Recognised shapes (in priority order):
 *
 *   1. `{ before: {...}, after: {...} }` — true side-by-side.
 *      Used by Phase 4+ services that snapshot the doc state on
 *      both sides of the mutation.
 *
 *   2. `{ changes: string[] }` — list of field names that were
 *      changed (no values). Used by `plan_coupon.updated` and
 *      similar lightweight emitters where the runtime can't easily
 *      project the before/after slice.
 *
 *   3. Anything else — JSON pretty-print. Last-resort but always
 *      truthful: an operator can still see what the listener
 *      recorded.
 *
 * Strings that look like ISO timestamps are formatted in
 * `Africa/Dakar` so the diff matches the rest of the admin UI's
 * timezone convention.
 */

import { useMemo } from "react";

interface Props {
  details: unknown;
  /**
   * The action verb (`event.updated`, `plan.archived`, etc). Used
   * solely to colour-code the diff header — has no effect on
   * detection logic.
   */
  action?: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") {
    if (ISO_DATE_RE.test(v)) {
      try {
        return new Date(v).toLocaleString("fr-SN", {
          timeZone: "Africa/Dakar",
          dateStyle: "short",
          timeStyle: "short",
        });
      } catch {
        return v;
      }
    }
    return v;
  }
  if (typeof v === "boolean") return v ? "oui" : "non";
  if (typeof v === "number") return v.toLocaleString("fr-FR");
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function AuditDiffView({ details }: Props) {
  const shape = useMemo(() => detectShape(details), [details]);

  if (shape.kind === "before-after") {
    return <BeforeAfterDiff before={shape.before} after={shape.after} />;
  }

  if (shape.kind === "changes") {
    return <ChangedFieldsList fields={shape.fields} />;
  }

  return <JsonFallback details={details} />;
}

// ─── Shape detection ───────────────────────────────────────────────────────

type DetailsShape =
  | { kind: "before-after"; before: Record<string, unknown>; after: Record<string, unknown> }
  | { kind: "changes"; fields: string[] }
  | { kind: "json" };

function detectShape(details: unknown): DetailsShape {
  if (!details || typeof details !== "object") return { kind: "json" };
  const obj = details as Record<string, unknown>;
  if (
    obj.before &&
    obj.after &&
    typeof obj.before === "object" &&
    typeof obj.after === "object"
  ) {
    return {
      kind: "before-after",
      before: obj.before as Record<string, unknown>,
      after: obj.after as Record<string, unknown>,
    };
  }
  if (Array.isArray(obj.changes) && obj.changes.every((v) => typeof v === "string")) {
    return { kind: "changes", fields: obj.changes as string[] };
  }
  return { kind: "json" };
}

// ─── Renderers ─────────────────────────────────────────────────────────────

function BeforeAfterDiff({
  before,
  after,
}: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  // Union of keys so a field added or removed shows up exactly once.
  const keys = useMemo(
    () => Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort(),
    [before, after],
  );

  // Skip rows whose before === after — same value on both sides
  // means the listener captured them for context, not because they
  // actually changed. Reduces visual noise on dense docs.
  const changedKeys = keys.filter((k) => !shallowEqual(before[k], after[k]));

  if (changedKeys.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        Aucune différence détectée entre l&apos;avant et l&apos;après.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-xs">
        <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 font-medium">Champ</th>
            <th className="px-3 py-1.5 font-medium">Avant</th>
            <th className="px-3 py-1.5 font-medium">Après</th>
          </tr>
        </thead>
        <tbody>
          {changedKeys.map((key) => (
            <tr key={key} className="border-t border-border">
              <td className="px-3 py-1.5 font-mono text-[11px] text-foreground">{key}</td>
              <td className="px-3 py-1.5 align-top text-red-600 dark:text-red-400">
                <span className="line-through">{formatScalar(before[key])}</span>
              </td>
              <td className="px-3 py-1.5 align-top text-teranga-green">
                {formatScalar(after[key])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChangedFieldsList({ fields }: { fields: string[] }) {
  if (fields.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        Aucun champ modifié n&apos;a été enregistré.
      </div>
    );
  }
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/20 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Champs modifiés
      </div>
      <div className="flex flex-wrap gap-1">
        {fields.map((field) => (
          <code
            key={field}
            className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground"
          >
            {field}
          </code>
        ))}
      </div>
    </div>
  );
}

function JsonFallback({ details }: { details: unknown }) {
  let pretty: string;
  try {
    pretty = JSON.stringify(details, null, 2);
  } catch {
    pretty = String(details);
  }
  return (
    <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/20 p-3 text-[11px] leading-relaxed text-foreground">
      {pretty}
    </pre>
  );
}

// ─── Utilities ─────────────────────────────────────────────────────────────

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}
