import { z } from "zod";
import { getApp } from "firebase-admin/app";
import { type JobHandler } from "../types";
import { config } from "@/config";

/**
 * Sprint-3 T4.3 closure — Firestore backup admin job.
 *
 * Triggers a Firestore Admin export to the configured GCS bucket
 * (`FIRESTORE_BACKUP_BUCKET`). The export is started server-side via
 * the Firestore Admin v1 REST API; the call returns immediately with
 * a long-running operation id. The job records the operation id in
 * its run output so an operator can track progress via `gcloud
 * firestore operations describe <op-id>` (the runbook documents the
 * full procedure).
 *
 * Why REST and not the SDK: the `@google-cloud/firestore-admin`
 * client is a separate ~5 MB dependency we'd pull in just for this
 * one call. The Firestore Admin REST API is stable and the request
 * is two lines of fetch — keeps the deploy footprint tight.
 *
 * Authentication: relies on Application Default Credentials (Cloud
 * Run injects the service account token automatically). The Firebase
 * Admin SDK already uses ADC; we reuse its initialised credential
 * so we don't need a second auth path.
 *
 * Permission: gated upstream by the admin job runner
 * (`platform:manage`). The handler itself only enforces the
 * `FIRESTORE_BACKUP_BUCKET` precondition.
 *
 * Failure modes documented in the runbook:
 *   - "FIRESTORE_BACKUP_BUCKET unset" → operator hasn't enabled the
 *     feature; pass to infra to provision the bucket.
 *   - "PERMISSION_DENIED" → service account lacks
 *     `roles/datastore.importExportAdmin` or `roles/storage.admin`
 *     on the target bucket.
 *   - "FAILED_PRECONDITION" → another export is already running
 *     against the database. Firestore enforces one concurrent
 *     export per database.
 */

const inputSchema = z
  .object({
    /**
     * Comma-separated whitelist of collection ids to export. Empty
     * (default) means "every top-level collection". Common picks for
     * a hot-fix pre-mutation backup: just the collections about to
     * be touched (`organizations,users,subscriptions`).
     */
    collectionIds: z
      .string()
      .max(500)
      .optional()
      .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [])),
    /**
     * Optional sub-prefix appended to the bucket. Useful for tagging
     * a manual backup with the change description ("pre-plan-migration").
     * Sanitised to `[a-zA-Z0-9_-]` to avoid path traversal or weird
     * GCS path semantics.
     */
    label: z
      .string()
      .max(50)
      .regex(/^[a-zA-Z0-9_-]+$/, "label must match [a-zA-Z0-9_-]+")
      .optional(),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

async function getAccessToken(): Promise<string> {
  // Reuse the already-initialised Firebase Admin app's credential.
  // `getAccessToken()` returns a fresh OAuth bearer for the
  // configured service account (workload identity in prod, ADC
  // locally) — exactly what the Firestore Admin REST API expects.
  const credential = getApp().options.credential;
  if (!credential) {
    throw new Error("Firebase Admin app has no credential configured");
  }
  const token = await credential.getAccessToken();
  return token.access_token;
}

export const firestoreBackupHandler: JobHandler<Input> = {
  descriptor: {
    jobKey: "firestore-backup",
    titleFr: "Backup Firestore",
    titleEn: "Firestore backup",
    descriptionFr:
      "Déclenche un export Firestore vers le bucket GCS configuré. Retourne l'id de l'opération à long terme — suivre via gcloud.",
    descriptionEn:
      "Triggers a Firestore export to the configured GCS bucket. Returns the long-running operation id — track via gcloud.",
    hasInput: true,
    exampleInput: { collectionIds: "organizations,users", label: "pre-migration" },
    dangerNoteFr:
      "Aucun effet sur les données en place — c'est un export en lecture. Mais GCS facture le stockage : nettoyer les anciens exports régulièrement.",
    dangerNoteEn:
      "No effect on live data — this is a read-only export. GCS charges for storage: prune old exports regularly.",
  },
  inputSchema,
  run: async (input: Input, ctx) => {
    const bucket = config.FIRESTORE_BACKUP_BUCKET;
    if (!bucket) {
      throw new Error(
        "FIRESTORE_BACKUP_BUCKET env var is not set — backup feature disabled. See docs/runbooks/backup-restore.md to enable.",
      );
    }
    if (ctx.signal.aborted) throw new Error("aborted");

    // Build the timestamped prefix. ISO 8601 minus colons (GCS path
    // ergonomics). The label is appended when present so an operator
    // listing exports in `gsutil ls` can spot the right one.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const prefix = input.label ? `${stamp}--${input.label}` : stamp;
    const outputUriPrefix = `${bucket}/${prefix}`;

    const projectId = config.FIREBASE_PROJECT_ID;
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      projectId,
    )}/databases/(default):exportDocuments`;

    const body: Record<string, unknown> = { outputUriPrefix };
    if (input.collectionIds.length > 0) {
      body.collectionIds = input.collectionIds;
    }

    ctx.log("backup.requested", {
      outputUriPrefix,
      collectionCount: input.collectionIds.length,
    });

    const accessToken = await getAccessToken();

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctx.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      ctx.log("backup.failed", { status: res.status, body: text.slice(0, 500) });
      throw new Error(
        `Firestore export failed: HTTP ${res.status} — ${text.slice(0, 200)}`,
      );
    }

    const json = (await res.json()) as { name?: string; metadata?: { startTime?: string } };
    const operation = json.name ?? "<unknown>";
    ctx.log("backup.started", { operation, startTime: json.metadata?.startTime });

    return `Export started → ${outputUriPrefix} (operation: ${operation}). Track via: gcloud firestore operations describe "${operation}"`;
  },
};
