import { z } from "zod";
import { BaseService } from "./base.service";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { db, COLLECTIONS } from "@/config/firebase";
import { config } from "@/config/index";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/errors/app-error";
import { rateLimit } from "./rate-limit.service";
import { adminJobRunsRepository } from "@/repositories/admin-job-runs.repository";
import { getHandler, listHandlers } from "@/jobs/registry";
import {
  ERROR_CODES,
  type AdminJobDescriptor,
  type AdminJobRun,
  type AdminJobRunsQuery,
} from "@teranga/shared-types";
import type { PaginatedResult } from "@/repositories/base.repository";
import type { JobContext } from "@/jobs/types";

/**
 * Admin job runner service — list, trigger, track.
 *
 * See `packages/shared-types/src/admin-jobs.types.ts` for the
 * architectural rationale. This service is the glue between:
 *   - the registry (handler metadata + run function),
 *   - the `adminJobRuns` collection (one doc per invocation),
 *   - the `adminJobLocks` collection (single-flight per jobKey),
 *   - the audit trail (eventBus emissions at start + finish),
 *   - the rate limiter (5 runs/min/admin).
 *
 * Execution model: synchronous. The POST /run request holds open
 * until the handler returns or the 5-minute timeout fires. A
 * background worker migration (Pub/Sub → Cloud Functions) is
 * deliberately deferred; the handler contract takes an AbortSignal
 * so that migration won't require touching handler code.
 */

const MAX_RUN_MS = 5 * 60_000; // 5 minutes
const OUTPUT_MAX_CHARS = 10 * 1024; // 10 KB; Firestore doc cap is 1 MiB
const STACK_MAX_CHARS = 4 * 1024;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `… [truncated, original length ${s.length}]`;
}

/**
 * Resolve the admin's narrowest role for audit stamping. Same pattern
 * as impersonation — `super_admin` and `platform:super_admin` are
 * treated distinctly in the audit row even though both hold
 * `platform:manage`.
 */
function resolveActorRole(user: AuthUser): string {
  if (user.roles.includes("platform:super_admin")) return "platform:super_admin";
  if (user.roles.includes("super_admin")) return "super_admin";
  // Other `platform:*` roles can hit the runner via `platform:manage`
  // today; they get their role echoed verbatim for the audit trail.
  return user.roles.find((r) => r.startsWith("platform:")) ?? "super_admin";
}

class AdminJobsService extends BaseService {
  // ─── Listing ──────────────────────────────────────────────────────────────

  listRegisteredJobs(user: AuthUser): AdminJobDescriptor[] {
    this.requirePermission(user, "platform:manage");
    return listHandlers().map((h) => h.descriptor);
  }

  async listRuns(user: AuthUser, query: AdminJobRunsQuery): Promise<PaginatedResult<AdminJobRun>> {
    this.requirePermission(user, "platform:manage");
    return adminJobRunsRepository.list(query);
  }

  async getRun(user: AuthUser, runId: string): Promise<AdminJobRun> {
    this.requirePermission(user, "platform:manage");
    const run = await adminJobRunsRepository.findById(runId);
    if (!run) throw new NotFoundError("Admin job run", runId);
    return run;
  }

  // ─── Triggering ───────────────────────────────────────────────────────────

  async runJob(
    user: AuthUser,
    jobKey: string,
    rawInput: Record<string, unknown> | undefined,
    actorDisplayName: string | null,
  ): Promise<AdminJobRun> {
    this.requirePermission(user, "platform:manage");

    // Per-admin rate limit so a scripted caller can't hammer the runner.
    // 5/min is generous for real operator workflows (operator clicks a
    // button; cooldown on the other 4 slots). Shares the shape used by
    // impersonation + test-send.
    const rl = await rateLimit({
      scope: "admin.run_job",
      identifier: user.uid,
      limit: 5,
      windowSec: 60,
    });
    if (!rl.allowed) {
      throw new ForbiddenError(
        `Quota de déclenchement atteint (5/min). Réessayez dans ${rl.retryAfterSec ?? 60}s.`,
      );
    }

    // Registry lookup. Keep the error shape narrow — we never surface
    // "did you mean X" suggestions because that would enumerate the
    // registered jobs to a caller who already holds platform:manage
    // (not a security issue, just not useful).
    const handler = getHandler(jobKey);
    if (!handler) {
      // Do NOT echo the operator-supplied jobKey in the top-level
      // message (security review #5). The caller is authenticated as
      // super-admin so information leakage is low-risk, but reflecting
      // user-supplied input in error bodies is a reflex to avoid. The
      // jobKey lands in `details.jobKey` for operator tooling.
      throw new AppError({
        code: ERROR_CODES.ADMIN_JOB_NOT_FOUND,
        message: "Requested job does not exist.",
        statusCode: 404,
        details: { jobKey },
      });
    }

    // Input validation — handler schema, or strict empty-object when
    // the handler declares none. Rejecting unknown keys defensively
    // protects handlers from receiving stray fields.
    const schema = handler.inputSchema ?? z.object({}).strict();
    const parsed = schema.safeParse(rawInput ?? {});
    if (!parsed.success) {
      throw new AppError({
        code: ERROR_CODES.ADMIN_JOB_INVALID_INPUT,
        message: "Invalid input for job",
        statusCode: 400,
        details: parsed.error.flatten(),
      });
    }

    const actorRole = resolveActorRole(user);
    const runId = db.collection(COLLECTIONS.ADMIN_JOB_RUNS).doc().id;
    const triggeredAt = new Date().toISOString();

    // Acquire the single-flight lock BEFORE writing the run doc so
    // there's no period where the run row exists but the lock check
    // hasn't yet gated it. The lock carries an `expiresAt` so a
    // crashed handler doesn't wedge the job — any caller that sees
    // a stale lock (expiresAt < now) overwrites it and proceeds.
    const lockRef = db.collection(COLLECTIONS.ADMIN_JOB_LOCKS).doc(jobKey);
    const lockExpiresAt = new Date(Date.now() + MAX_RUN_MS).toISOString();
    await db.runTransaction(async (tx) => {
      const lockSnap = await tx.get(lockRef);
      if (lockSnap.exists) {
        const data = lockSnap.data() as { expiresAt?: string };
        if (data.expiresAt && new Date(data.expiresAt).getTime() > Date.now()) {
          throw new ConflictError("Job already running", {
            reason: "admin_job_already_running",
            jobKey,
          });
        }
        // Stale lock — overwrite.
      }
      tx.set(lockRef, {
        jobKey,
        heldBy: user.uid,
        runId,
        acquiredAt: triggeredAt,
        expiresAt: lockExpiresAt,
      });
    });

    const abort = new AbortController();
    const timeoutId = setTimeout(() => abort.abort(), MAX_RUN_MS);

    const logLines: string[] = [];
    const ctx: JobContext = {
      signal: abort.signal,
      actor: user,
      runId,
      log: (event, data) => {
        const line =
          JSON.stringify({ event, ts: new Date().toISOString(), ...(data ?? {}) }) + "\n";
        logLines.push(line);
      },
    };

    let status: AdminJobRun["status"] = "succeeded";
    let output: string | null = null;
    let errorRow: AdminJobRun["error"] = null;
    // `startedAt` starts as the trigger time so that even if the
    // update-to-running write fails, the run row still carries a
    // valid timestamp for the duration calc in the finally block.
    let startedAt: string = triggeredAt;

    try {
      // Initial run row — INSIDE the try block (security review #3).
      // If `create()` or the subsequent audit write throws, the
      // finally block still fires, releases the lock, and marks the
      // run failed. Previously a Firestore transient between lock
      // acquire and run handler start would strand the lock for up
      // to 5 minutes (stale-lock reclaim horizon).
      const initial: AdminJobRun = {
        id: runId,
        jobKey,
        status: "queued",
        triggeredBy: user.uid,
        triggeredByDisplayName: actorDisplayName,
        triggeredByRole: actorRole,
        input: parsed.data as Record<string, unknown>,
        triggeredAt,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        output: null,
        error: null,
        requestId: getRequestId(),
      };
      await adminJobRunsRepository.create(initial);

      eventBus.emit("admin.job_triggered", {
        actorUid: user.uid,
        jobKey,
        runId,
      });

      // Mark `running`. Split from create() so the `running` timestamp
      // is independent of the create-ack timing.
      startedAt = new Date().toISOString();
      await adminJobRunsRepository.update(runId, { status: "running", startedAt });

      // Audit the trigger synchronously. The `completed` audit row is
      // emitted in the finally block so every run has exactly two
      // audit entries regardless of outcome.
      await db.collection(COLLECTIONS.AUDIT_LOGS).add({
        action: "admin.job_triggered",
        actorId: user.uid,
        actorRole,
        resourceType: "admin_job_run",
        resourceId: runId,
        organizationId: null,
        details: { jobKey, input: parsed.data, triggeredAt },
        requestId: getRequestId(),
        timestamp: triggeredAt,
      });

      // Promise.race against the AbortSignal so a handler that ignores
      // `ctx.signal` still lands as a typed `ADMIN_JOB_TIMEOUT`
      // failure within 5 minutes — not when Cloud Run's 60-minute
      // request timeout fires. A well-behaved handler honours the
      // signal and surfaces its own error; this is belt-and-braces
      // for the misbehaved case. Note: the rogue handler keeps
      // running in the background (we can't forcibly cancel a JS
      // Promise); that's acceptable for V1 since the handler set is
      // engineering-controlled. User-defined handlers would need
      // Worker-based isolation.
      const timeoutPromise = new Promise<never>((_, reject) => {
        abort.signal.addEventListener("abort", () => reject(new Error("admin_job_timeout")), {
          once: true,
        });
      });
      const result = await Promise.race([handler.run(parsed.data, ctx), timeoutPromise]);
      // Concatenate handler return value + captured log lines into one
      // blob so operators see both in the run-detail modal. Result
      // first (headline), logs second (breadcrumbs).
      const body = (result ? result + "\n\n" : "") + (logLines.length ? logLines.join("") : "");
      output = truncate(body, OUTPUT_MAX_CHARS);
    } catch (err) {
      status = "failed";
      const isTimeout = abort.signal.aborted;
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : "handler threw";
      const code = isTimeout
        ? ERROR_CODES.ADMIN_JOB_TIMEOUT
        : ((err as { code?: string })?.code ?? "HANDLER_ERROR");
      errorRow = {
        code,
        message: isTimeout ? "Handler exceeded 5-minute execution budget" : message,
        stack:
          config.NODE_ENV === "production"
            ? null
            : err instanceof Error && err.stack
              ? truncate(err.stack, STACK_MAX_CHARS)
              : null,
      };
      // Persist captured logs even on failure so the operator can see
      // what progress was made before the throw.
      if (logLines.length) output = truncate(logLines.join(""), OUTPUT_MAX_CHARS);
    } finally {
      clearTimeout(timeoutId);
      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      // Every cleanup step is independently try/catched so a failure
      // in one doesn't skip the others (security review #2). The
      // lock release in particular MUST always run; without it a
      // single Firestore hiccup wedges the job for 5 minutes. All
      // cleanup errors are captured via structured stderr so ops has
      // a signal when something's wrong.
      try {
        await adminJobRunsRepository.update(runId, {
          status,
          completedAt,
          durationMs,
          output,
          error: errorRow,
        });
      } catch (e) {
        process.stderr.write(
          JSON.stringify({
            level: "error",
            event: "admin_jobs.terminal_update_failed",
            runId,
            jobKey,
            err: e instanceof Error ? e.message : String(e),
          }) + "\n",
        );
      }

      try {
        await lockRef.delete();
      } catch (e) {
        // Stale-lock reclaim on the next trigger is the safety net.
        process.stderr.write(
          JSON.stringify({
            level: "warn",
            event: "admin_jobs.lock_release_failed",
            runId,
            jobKey,
            err: e instanceof Error ? e.message : String(e),
          }) + "\n",
        );
      }

      try {
        await db.collection(COLLECTIONS.AUDIT_LOGS).add({
          action: "admin.job_completed",
          actorId: user.uid,
          actorRole,
          resourceType: "admin_job_run",
          resourceId: runId,
          organizationId: null,
          details: {
            jobKey,
            status,
            durationMs,
            errorCode: errorRow?.code ?? null,
          },
          requestId: getRequestId(),
          timestamp: completedAt,
        });
      } catch (e) {
        process.stderr.write(
          JSON.stringify({
            level: "error",
            event: "admin_jobs.completed_audit_failed",
            runId,
            jobKey,
            err: e instanceof Error ? e.message : String(e),
          }) + "\n",
        );
      }

      // Event bus emissions are in-process + synchronous — won't
      // throw under normal circumstances, but wrap defensively.
      try {
        eventBus.emit("admin.job_completed", {
          actorUid: user.uid,
          jobKey,
          runId,
          status,
          durationMs,
        });
      } catch {
        /* event bus failures are not load-bearing */
      }
    }

    // Re-read the run doc so the caller sees the terminal row (same
    // shape the UI polls). Consistency gained by reading vs. hand-
    // building is worth the extra read.
    const final = await adminJobRunsRepository.findById(runId);
    if (!final) {
      // Should never happen — we just wrote it. Throw a typed
      // internal error rather than returning a fabricated row.
      throw new AppError({
        code: ERROR_CODES.INTERNAL_ERROR,
        message: "Run row disappeared after write",
        statusCode: 500,
      });
    }
    return final;
  }
}

export const adminJobsService = new AdminJobsService();
