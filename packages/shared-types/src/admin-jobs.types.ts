import { z } from "zod";

/**
 * Admin job runner — typed contracts for the trigger + history surface.
 *
 * Design (see `apps/api/src/jobs/registry.ts` for the canonical docs):
 *   - A **job** is a named, server-side handler registered in the API
 *     (`rebuild-usage-counters`, `prune-expired-invites`, …). Each
 *     handler declares a Zod input schema, a fr/en description, and an
 *     async run function that receives an AbortSignal + structured
 *     logger.
 *   - A **run** is a single execution of a job. One Firestore doc per
 *     run in `adminJobRuns`; status, input, output, error, timings.
 *   - Execution is **synchronous** within the POST /run request for
 *     V1. Hard 5-minute timeout. Migration path to Pub/Sub-backed
 *     workers preserved by the AbortSignal-aware handler signature.
 *   - **Single-flight per jobKey**: transactional doc in
 *     `adminJobLocks/{jobKey}`. Stale locks (> 5 min) are
 *     auto-reclaimable so a crashed run doesn't wedge the job.
 *   - **platform:manage only.** Every endpoint gated by the route
 *     `requirePermission("platform:manage")`.
 *   - **Output truncated to 10 KB** at write time so a rogue handler
 *     can't balloon Firestore writes.
 *
 * Industry precedent: Sidekiq Pro, Temporal / Airflow one-shot DAGs,
 * Render.com one-off jobs, GitHub Actions `workflow_dispatch`. The
 * lowest-common shape: registry of named handlers + trigger-by-name +
 * doc-per-run history with status + logs.
 */

// ─── Status ──────────────────────────────────────────────────────────────────

export const AdminJobStatusSchema = z.enum([
  "queued", // row created; before the handler starts running
  "running", // handler is executing
  "succeeded", // handler returned without throwing
  "failed", // handler threw OR aborted (timeout)
  "cancelled", // reserved for future worker-mode; unused in V1
]);
export type AdminJobStatus = z.infer<typeof AdminJobStatusSchema>;

// ─── Run doc ────────────────────────────────────────────────────────────────
// Shape of a document in the `adminJobRuns` collection. All timestamps are
// ISO strings — Firestore Timestamp is never surfaced across the API
// boundary (mirrors the rest of the platform, CLAUDE.md ruleset).

export const AdminJobRunSchema = z.object({
  id: z.string(),
  jobKey: z.string(),
  status: AdminJobStatusSchema,
  /** Admin uid who triggered the run. */
  triggeredBy: z.string(),
  triggeredByDisplayName: z.string().nullable(),
  /** Actor role stamp — `super_admin` or `platform:super_admin`. */
  triggeredByRole: z.string(),
  /**
   * Validated handler input (copied from the POST body). `null` when
   * the handler declares no input schema. Stored verbatim so an
   * operator replaying a run has the exact arguments used.
   */
  input: z.record(z.string(), z.unknown()).nullable(),
  triggeredAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  /** Wall-clock duration in ms. `null` while running; set on terminal status. */
  durationMs: z.number().int().nullable(),
  /**
   * Free-text summary returned by the handler (`return "…"`).
   * Truncated to 10 KB at write time. Never contains secrets — the
   * handler is responsible for redaction. Rendered verbatim in the
   * run-detail modal.
   */
  output: z.string().nullable(),
  /**
   * Failure detail when `status === "failed"`. `code` is the
   * Firebase / handler-level error code; `message` is
   * localised-ish; `stack` is present in non-production only.
   */
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      stack: z.string().nullable().optional(),
    })
    .nullable(),
  /** Propagated request id so run ⇄ audit log ⇄ trace can be joined. */
  requestId: z.string(),
});
export type AdminJobRun = z.infer<typeof AdminJobRunSchema>;

// ─── Registered-job descriptor ───────────────────────────────────────────────
// Narrow, serializable metadata about a registered handler — no function
// references, no runtime state. The GET /v1/admin/jobs listing endpoint
// returns an array of these so the UI can render the "Run" grid.

export const AdminJobDescriptorSchema = z.object({
  jobKey: z.string(),
  titleFr: z.string(),
  titleEn: z.string(),
  descriptionFr: z.string(),
  descriptionEn: z.string(),
  /**
   * JSON-representable summary of the Zod input schema — `null` when
   * the handler is zero-arg. We don't ship the full Zod shape over
   * the wire; the UI renders a generic JSON textarea for inputs.
   * Handlers validate server-side on receive, so a malformed client
   * body lands as a typed 400.
   */
  hasInput: z.boolean(),
  /**
   * Optional one-liner example input. Surfaced as a placeholder in
   * the UI so operators see the expected shape at a glance.
   */
  exampleInput: z.record(z.string(), z.unknown()).nullable(),
  /**
   * Optional danger note. Rendered as a destructive-styled caveat
   * (e.g. "This writes to all organizations — irreversible.").
   * Matches the Stripe / Sidekiq pattern for "destructive" jobs.
   */
  dangerNoteFr: z.string().nullable(),
  dangerNoteEn: z.string().nullable(),
  /**
   * Sprint-4 T3.2 follow-up — when true, the job is refused by the
   * `scheduledOpsService.create` allowlist. Manual triggers from
   * `/admin/jobs` still work (they require an explicit operator
   * click + confirmation), but cron-driven automation of a
   * destructive op is gated behind a deliberate per-job opt-in.
   * Defaults to undefined (= treated as non-dangerous) so existing
   * handlers don't need a per-file opt-in.
   */
  dangerous: z.boolean().optional(),
});
export type AdminJobDescriptor = z.infer<typeof AdminJobDescriptorSchema>;

// ─── Request bodies + query ──────────────────────────────────────────────────

/**
 * POST /v1/admin/jobs/:jobKey/run — body. Handler-specific validation
 * happens server-side via the registered Zod schema. `input` is
 * `Record<string, unknown>` here so the transport is open; rejecting
 * a bad shape is the handler's job, not the transport's.
 */
export const RunAdminJobRequestSchema = z.object({
  input: z.record(z.string(), z.unknown()).optional(),
});
export type RunAdminJobRequest = z.infer<typeof RunAdminJobRequestSchema>;

/**
 * GET /v1/admin/jobs/runs — query. Filters for the history table;
 * all optional. `status` narrows to a single status; `jobKey`
 * narrows to a specific job. Pagination follows the platform's
 * standard `page / limit / orderBy / orderDir` contract.
 */
export const AdminJobRunsQuerySchema = z.object({
  jobKey: z.string().min(1).max(80).optional(),
  status: AdminJobStatusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type AdminJobRunsQuery = z.infer<typeof AdminJobRunsQuerySchema>;


// ─── Sprint-4 T3.2 — Scheduled admin operations ──────────────────────────
//
// Operators define recurring runs of registered admin jobs ("auto-
// archive events completed > 90 days", "send a J-7 payment reminder
// for events that still have pending registrations"). The schedule
// itself is stored in Firestore; a Cloud Functions scheduled trigger
// (every 5 min) wakes up, scans for `enabled=true AND nextRunAt <= now`
// and dispatches each into the existing admin job runner.

const CRON_FIELD = /^(\*|\d+|\d+-\d+|\*\/\d+|(?:\d+,)+\d+)$/;
export const CronExpressionSchema = z
  .string()
  .min(7)
  .max(80)
  .refine(
    (v) => {
      const fields = v.trim().split(/\s+/);
      if (fields.length !== 5) return false;
      return fields.every((f) => CRON_FIELD.test(f));
    },
    { message: "cron must be 5 space-separated fields (m h dom mon dow)" },
  );

export const ScheduledAdminOpStatusSchema = z.enum(["active", "archived"]);
export type ScheduledAdminOpStatus = z.infer<typeof ScheduledAdminOpStatusSchema>;

export const ScheduledAdminOpSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  jobKey: z.string().min(1).max(80),
  jobInput: z.record(z.string(), z.unknown()).default({}),
  cron: CronExpressionSchema,
  timezone: z.string().min(1).max(80).default("Africa/Dakar"),
  enabled: z.boolean().default(true),
  /**
   * Sprint-4 T3.2 follow-up — soft-delete status. Operators
   * "delete" via the UI, which flips `status: "archived"` instead
   * of removing the doc. The list endpoint filters archived rows
   * by default. Mirrors the platform-wide soft-delete-only rule
   * (CLAUDE.md § Security Hardening Checklist row "No hard
   * deletes").
   */
  status: ScheduledAdminOpStatusSchema.default("active"),
  nextRunAt: z.string().datetime(),
  lastRunAt: z.string().datetime().nullable(),
  lastRunRunId: z.string().nullable(),
  lastRunStatus: AdminJobStatusSchema.nullable(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ScheduledAdminOp = z.infer<typeof ScheduledAdminOpSchema>;

export const CreateScheduledAdminOpSchema = z.object({
  name: z.string().min(1).max(120),
  jobKey: z.string().min(1).max(80),
  jobInput: z.record(z.string(), z.unknown()).optional(),
  cron: CronExpressionSchema,
  timezone: z.string().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
});
export type CreateScheduledAdminOpDto = z.infer<typeof CreateScheduledAdminOpSchema>;

export const UpdateScheduledAdminOpSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  jobInput: z.record(z.string(), z.unknown()).optional(),
  cron: CronExpressionSchema.optional(),
  timezone: z.string().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateScheduledAdminOpDto = z.infer<typeof UpdateScheduledAdminOpSchema>;

