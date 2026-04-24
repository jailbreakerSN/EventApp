import type { ZodType, ZodTypeDef } from "zod";
import { type AuthUser } from "@/middlewares/auth.middleware";
import { type AdminJobDescriptor } from "@teranga/shared-types";

/**
 * Context handed to every job handler at invocation time.
 *
 * `signal` — the handler MUST honour this AbortSignal. The admin jobs
 * service arms it with a 5-minute hard timeout; long-running
 * handlers should pass it through to every Firestore / fetch call
 * they make (both APIs natively support AbortController).
 *
 * `actor` — the AuthUser who triggered the run. Handlers that need
 * to audit nested writes get the actor uid + roles from here,
 * mirroring what they'd normally pick up from `request.user` in a
 * route handler.
 *
 * `log` — structured logger that prepends run metadata. Output is
 * captured by the service layer and truncated to 10 KB before being
 * persisted to the run doc.
 */
export interface JobContext {
  signal: AbortSignal;
  actor: AuthUser;
  log: (event: string, data?: Record<string, unknown>) => void;
  /**
   * Run id — handlers that mutate many rows per batch emit their own
   * domain events (e.g. `invite.bulk_expired`) and need to tag the
   * event with the parent runId so the audit trail can join run →
   * bulk-event. Exposed read-only so the handler can't forge a
   * different run's id.
   */
  runId: string;
}

/**
 * Contract a registered handler must satisfy.
 *
 * `inputSchema` — Zod schema for the POST body's `input` field. When
 *   set, the service validates incoming bodies against it before
 *   calling `run()`. Handlers that take no input omit this field.
 * `run()` — async implementation. Return value is the human-readable
 *   summary surfaced in the run-detail modal. Throw to fail.
 */
// The three-arg `ZodType<Output, Def, Input>` is deliberate: schemas
// with `.default(…)` produce `Output = T` but `Input = T | undefined`.
// The `JobHandler` is parameterised on Output (what the handler
// receives after parsing), so this keeps `ping({ message?: string })`
// and `prune-expired-invites({ maxRows: number })` both expressible.
export interface JobHandler<TInput = unknown> {
  descriptor: AdminJobDescriptor;
  inputSchema?: ZodType<TInput, ZodTypeDef, unknown>;
  run: (input: TInput, ctx: JobContext) => Promise<string>;
}
