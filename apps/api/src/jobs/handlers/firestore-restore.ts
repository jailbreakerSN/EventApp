import { z } from "zod";
import { getApp } from "firebase-admin/app";
import { type JobHandler } from "../types";
import { config } from "@/config";

/**
 * Sprint-3 T4.3 closure — Firestore restore admin job.
 *
 * Triggers a Firestore Admin import from a previously-completed
 * export prefix. DESTRUCTIVE: imports overwrite documents that share
 * an id with the backup. The job's `dangerNote` makes that
 * explicit; the runbook walks through the safer pattern (restore
 * to a clone project first, validate, then promote).
 *
 * The handler accepts a fully-qualified `inputUriPrefix` rather than
 * a label — the operator MUST have eyeballed the GCS path before
 * triggering. We deliberately avoid an "auto-pick latest" mode
 * here: a destructive operation should not be one click away from
 * "wrong backup". Industry precedent: Stripe's data tools, GCP's
 * own console.
 *
 * Same auth + REST API model as the backup handler.
 */

const inputSchema = z
  .object({
    /**
     * Full GCS path emitted by a previous export run, e.g.
     * `gs://teranga-backups/2026-04-25T10-00-00-000Z--pre-migration`.
     * MUST start with `gs://` and MUST be inside the configured
     * `FIRESTORE_BACKUP_BUCKET` (defence in depth: prevents an
     * operator from importing a foreign bucket they don't own).
     */
    inputUriPrefix: z.string().min(1).max(500).regex(/^gs:\/\//),
    /**
     * Optional collection whitelist — when set, only the named
     * collections are restored. Matches the `collectionIds` arg of
     * `exportDocuments`. Empty = restore everything in the export.
     */
    collectionIds: z
      .string()
      .max(500)
      .optional()
      .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [])),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

async function getAccessToken(): Promise<string> {
  const credential = getApp().options.credential;
  if (!credential) {
    throw new Error("Firebase Admin app has no credential configured");
  }
  const token = await credential.getAccessToken();
  return token.access_token;
}

export const firestoreRestoreHandler: JobHandler<Input> = {
  descriptor: {
    jobKey: "firestore-restore",
    titleFr: "Restore Firestore",
    titleEn: "Firestore restore",
    descriptionFr:
      "Importe un export Firestore depuis un préfixe GCS. ÉCRASE les documents existants partageant un même id.",
    descriptionEn:
      "Imports a Firestore export from a GCS prefix. OVERWRITES existing documents that share an id.",
    hasInput: true,
    exampleInput: {
      inputUriPrefix: "gs://teranga-backups/2026-04-25T10-00-00-000Z--pre-migration",
      collectionIds: "organizations,users",
    },
    dangerNoteFr:
      "DESTRUCTIF — l'import écrase tous les documents partageant un id avec l'export. Tester d'abord sur un projet clone.",
    dangerNoteEn:
      "DESTRUCTIVE — the import overwrites every document sharing an id with the export. Test on a clone project first.",
  },
  inputSchema,
  run: async (input: Input, ctx) => {
    const bucket = config.FIRESTORE_BACKUP_BUCKET;
    if (!bucket) {
      throw new Error(
        "FIRESTORE_BACKUP_BUCKET env var is not set — restore feature disabled. See docs/runbooks/backup-restore.md.",
      );
    }
    // Defence-in-depth — refuse imports from any path outside the
    // configured backup bucket. Prevents an operator from typoing
    // the wrong project's path or being tricked by a phishing
    // ticket "please restore from gs://attacker-controlled".
    if (!input.inputUriPrefix.startsWith(`${bucket}/`)) {
      throw new Error(
        `inputUriPrefix MUST be inside the configured backup bucket (${bucket}). Refusing to import "${input.inputUriPrefix}".`,
      );
    }
    if (ctx.signal.aborted) throw new Error("aborted");

    const projectId = config.FIREBASE_PROJECT_ID;
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      projectId,
    )}/databases/(default):importDocuments`;

    const body: Record<string, unknown> = { inputUriPrefix: input.inputUriPrefix };
    if (input.collectionIds.length > 0) {
      body.collectionIds = input.collectionIds;
    }

    ctx.log("restore.requested", {
      inputUriPrefix: input.inputUriPrefix,
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
      ctx.log("restore.failed", { status: res.status, body: text.slice(0, 500) });
      throw new Error(
        `Firestore import failed: HTTP ${res.status} — ${text.slice(0, 200)}`,
      );
    }

    const json = (await res.json()) as { name?: string };
    const operation = json.name ?? "<unknown>";
    ctx.log("restore.started", { operation });

    return `Import started ← ${input.inputUriPrefix} (operation: ${operation}). Track via: gcloud firestore operations describe "${operation}"`;
  },
};
