/**
 * Sprint-4 T3.2 closure — Scheduled admin operations service.
 *
 * Operators define recurring runs of registered admin jobs from the
 * back-office. Each scheduled op binds:
 *   - a registered job key (must exist in `apps/api/src/jobs/registry.ts`)
 *   - a frozen JSON input (validated against the handler's schema)
 *   - a 5-field cron expression + IANA timezone
 *   - an enabled flag (toggle without deletion)
 *
 * The actual triggering happens out-of-process: a Cloud Functions
 * scheduled trigger (every 5 min) reads `enabled=true AND
 * nextRunAt <= now`, dispatches each into the existing admin job
 * runner, and updates `lastRunAt` + `lastRunRunId` + `lastRunStatus`
 * + `nextRunAt` (advance by cron).
 *
 * This service exposes only the CRUD surface — the trigger is
 * documented in `docs/runbooks/scheduled-ops.md` and implemented
 * separately in `apps/functions/`.
 */

import {
  type ScheduledAdminOp,
  type CreateScheduledAdminOpDto,
  type UpdateScheduledAdminOpDto,
} from "@teranga/shared-types";
import { db, COLLECTIONS } from "@/config/firebase";
import { BaseService } from "./base.service";
import type { AuthUser } from "@/middlewares/auth.middleware";
import { eventBus } from "@/events/event-bus";
import { getRequestId } from "@/context/request-context";
import { ConflictError, NotFoundError, ValidationError } from "@/errors/app-error";
import { getHandler } from "@/jobs/registry";
import { nextCronRun } from "./cron";

class ScheduledOpsService extends BaseService {
  async list(user: AuthUser): Promise<ScheduledAdminOp[]> {
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);
    const snap = await db
      .collection(COLLECTIONS.SCHEDULED_ADMIN_OPS)
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();
    // Sprint-4 T3.2 follow-up — filter soft-deleted ("archived")
    // ops out of the default list. Archived rows stay in
    // Firestore for audit-trail continuity (the trigger logs +
    // domain events still reference them) but the back-office
    // doesn't surface them.
    return snap.docs
      .map((d) => d.data() as ScheduledAdminOp)
      .filter((op) => op.status !== "archived");
  }

  async get(user: AuthUser, opId: string): Promise<ScheduledAdminOp> {
    this.requireAnyPermission(user, ["platform:audit_read", "platform:manage"]);
    const doc = await db.collection(COLLECTIONS.SCHEDULED_ADMIN_OPS).doc(opId).get();
    if (!doc.exists) throw new NotFoundError("scheduledAdminOp", opId);
    return doc.data() as ScheduledAdminOp;
  }

  /**
   * Create a new scheduled op. Validates the job key against the
   * registry + the cron expression against the parser. Computes
   * `nextRunAt` from the cron + provided timezone so the trigger
   * has a value to compare against on its next wake-up.
   *
   * Permission: `platform:manage` — scheduling automated mutations
   * is a platform-wide privilege, gated to super-admin tier.
   */
  async create(user: AuthUser, dto: CreateScheduledAdminOpDto): Promise<ScheduledAdminOp> {
    this.requirePermission(user, "platform:manage");

    const handler = getHandler(dto.jobKey);
    if (!handler) {
      throw new ValidationError(
        `Unknown jobKey "${dto.jobKey}" — must be one of the registered admin jobs.`,
      );
    }

    // Sprint-4 T3.2 follow-up — refuse to schedule destructive
    // jobs on cron. The handler descriptor self-flags via
    // `dangerous: true` (currently set on `firestore-restore`).
    // Operators must trigger destructive jobs manually from
    // `/admin/jobs` so a confirmation dialog runs first.
    if (handler.descriptor.dangerous === true) {
      throw new ValidationError(
        `Job "${dto.jobKey}" is flagged dangerous and cannot be scheduled on cron. Trigger it manually from /admin/jobs.`,
      );
    }

    // Validate the input against the handler's schema. Operators
    // catch typos at create-time rather than at the first
    // scheduled run.
    const input = dto.jobInput ?? {};
    if (handler.inputSchema) {
      const parsed = handler.inputSchema.safeParse(input);
      if (!parsed.success) {
        throw new ValidationError(
          `jobInput failed validation: ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
        );
      }
    }

    const tz = dto.timezone ?? "Africa/Dakar";
    let nextRunAt: string;
    try {
      const next = nextCronRun(dto.cron, new Date(), tz);
      if (!next) {
        throw new ValidationError(
          `Cron expression "${dto.cron}" produced no future fire within 366 days.`,
        );
      }
      nextRunAt = next;
    } catch (err) {
      throw new ValidationError(
        `Invalid cron expression: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const now = new Date().toISOString();
    const ref = db.collection(COLLECTIONS.SCHEDULED_ADMIN_OPS).doc();
    const op: ScheduledAdminOp = {
      id: ref.id,
      name: dto.name,
      jobKey: dto.jobKey,
      jobInput: input,
      cron: dto.cron,
      timezone: tz,
      enabled: dto.enabled ?? true,
      status: "active",
      nextRunAt,
      lastRunAt: null,
      lastRunRunId: null,
      lastRunStatus: null,
      createdBy: user.uid,
      createdAt: now,
      updatedAt: now,
    };
    // Conflict guard — Firestore allows duplicate doc creation
    // because we use a generated id, so a concurrent same-name op
    // would silently coexist. Acceptable: operators see them both
    // in the list and disable the duplicate.
    await ref.set(op);

    eventBus.emit("scheduled_admin_op.created", {
      opId: op.id,
      jobKey: op.jobKey,
      cron: op.cron,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });

    return op;
  }

  async update(
    user: AuthUser,
    opId: string,
    dto: UpdateScheduledAdminOpDto,
  ): Promise<ScheduledAdminOp> {
    this.requirePermission(user, "platform:manage");

    const ref = db.collection(COLLECTIONS.SCHEDULED_ADMIN_OPS).doc(opId);
    const now = new Date().toISOString();

    const updated = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundError("scheduledAdminOp", opId);
      const current = snap.data() as ScheduledAdminOp;

      // Re-validate jobInput against the current handler if either
      // field changed — we don't accept the dto's input blindly.
      if (dto.jobInput !== undefined) {
        const handler = getHandler(current.jobKey);
        if (!handler) {
          throw new ConflictError(
            `Stored jobKey "${current.jobKey}" no longer exists — disable this op instead.`,
          );
        }
        if (handler.inputSchema) {
          const parsed = handler.inputSchema.safeParse(dto.jobInput);
          if (!parsed.success) {
            throw new ValidationError(
              `jobInput failed validation: ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
            );
          }
        }
      }

      // Recompute `nextRunAt` if cron or timezone changed.
      const nextCron = dto.cron ?? current.cron;
      const nextTz = dto.timezone ?? current.timezone;
      let nextRunAt = current.nextRunAt;
      if (dto.cron !== undefined || dto.timezone !== undefined) {
        const next = nextCronRun(nextCron, new Date(), nextTz);
        if (!next) {
          throw new ValidationError(
            `Cron expression "${nextCron}" produced no future fire within 366 days.`,
          );
        }
        nextRunAt = next;
      }

      const patch: Partial<ScheduledAdminOp> = {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.jobInput !== undefined ? { jobInput: dto.jobInput } : {}),
        ...(dto.cron !== undefined ? { cron: dto.cron } : {}),
        ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        nextRunAt,
        updatedAt: now,
      };

      tx.update(ref, patch);
      return { ...current, ...patch } as ScheduledAdminOp;
    });

    eventBus.emit("scheduled_admin_op.updated", {
      opId,
      changes: Object.keys(dto).filter(
        (k) => (dto as Record<string, unknown>)[k] !== undefined,
      ),
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });

    return updated;
  }

  /**
   * Sprint-4 T3.2 follow-up — SOFT delete. Flips `status: "archived"`
   * + `enabled: false` instead of removing the document. Mirrors the
   * platform-wide soft-delete-only rule (CLAUDE.md § Security
   * Hardening Checklist row "No hard deletes"). The archived row
   * stays in Firestore so the audit trail (cron history,
   * `lastRunRunId`, etc.) keeps resolving; the list endpoint
   * filters it out.
   */
  async delete(user: AuthUser, opId: string): Promise<void> {
    this.requirePermission(user, "platform:manage");
    const ref = db.collection(COLLECTIONS.SCHEDULED_ADMIN_OPS).doc(opId);

    const now = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundError("scheduledAdminOp", opId);
      const current = snap.data() as ScheduledAdminOp;
      if (current.status === "archived") {
        // Idempotent — already soft-deleted, no-op.
        return;
      }
      tx.update(ref, {
        status: "archived",
        enabled: false,
        updatedAt: now,
      });
    });

    eventBus.emit("scheduled_admin_op.deleted", {
      opId,
      actorId: user.uid,
      requestId: getRequestId(),
      timestamp: now,
    });
  }
}

export const scheduledOpsService = new ScheduledOpsService();
