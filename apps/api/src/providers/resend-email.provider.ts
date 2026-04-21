import { Resend } from "resend";
import {
  type EmailProvider,
  type EmailParams,
  type EmailResult,
  type BulkEmailResult,
  type BulkSendOptions,
} from "./email-provider.interface";

/**
 * Resend email provider — built on the official Node SDK (resend >= 6.9.2).
 *
 * Why the SDK rather than raw fetch: typed `{ data, error }` returns, built-in
 * idempotency-key option, first-class webhook verification (for Phase 3), and
 * the SDK tracks field renames (Segments vs. legacy Audiences) on our behalf.
 *
 * Endpoints used (mapped to SDK methods)
 * - resend.emails.send          POST /emails           single transactional
 * - resend.batch.send           POST /emails/batch     up to 100 transactional
 *                                                     (no attachments, no schedule)
 * - resend.broadcasts.create    POST /broadcasts       marketing to a Segment
 *                               (with send:true → create + send in one call)
 * - resend.contacts.create      POST /contacts         mirror newsletter subscriber;
 *                                                     assigns to a segment in the
 *                                                     same call
 * - resend.contacts.update      PATCH                  flip unsubscribed flag
 *
 * Resilience
 * - `rate_limit_exceeded` (429) and `api_error` (500) are retried with
 *   exponential backoff 1s → 2s → 4s, max 3 retries. Validation / auth /
 *   idempotency-conflict errors (400/401/403/409/422) are terminal — retrying
 *   them just burns time.
 *
 * Idempotency key convention
 * - Single:    `<event-type>/<entity-id>`       e.g. `reg-confirm/reg-1`
 * - Batch:     `batch-<event-type>/<batch-id>`  e.g. `batch-cancel/evt-42`
 *   For chunked batches the provider appends `/chunk-<index>` internally.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "events@terangaevent.com";
const RESEND_FROM_NAME = process.env.RESEND_FROM_NAME ?? "Teranga Events";
const DEFAULT_FROM = `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`;

const MAX_RETRIES = 3;

// Lazily constructed so test environments without RESEND_API_KEY don't
// instantiate an unusable client. getEmailProvider() only returns this
// provider when the key is set, so in practice the client is always valid
// by the time any method is called.
let sdk: Resend | null = null;
function getSdk(): Resend {
  if (!sdk) sdk = new Resend(RESEND_API_KEY);
  return sdk;
}

// ─── Types re-exported for callers ──────────────────────────────────────────

export interface ResendContactInput {
  email: string;
  firstName?: string;
  lastName?: string;
  unsubscribed?: boolean;
}

export interface ResendContactResult {
  success: boolean;
  contactId?: string;
  alreadyExists?: boolean;
  error?: string;
}

export interface ResendBroadcastInput {
  segmentId: string;
  /** Pre-formatted "Name <address>". Domain must be verified in Resend. */
  from: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /** Internal label shown in the Resend dashboard. */
  name?: string;
  /** ISO 8601 or natural language ("in 1 hour"). */
  scheduledAt?: string;
  idempotencyKey?: string;
}

export interface ResendBroadcastResult {
  success: boolean;
  broadcastId?: string;
  error?: string;
}

// ─── Retry wrapper ──────────────────────────────────────────────────────────

interface SdkResult<T> {
  data: T | null;
  error: { name?: string; message: string } | null;
}

// Which error types are worth retrying. Everything else is a client error
// where retry just burns time (or in the 409 case, actively masks a bug).
const RETRYABLE_ERRORS = new Set(["rate_limit_exceeded", "api_error"]);

async function withRetry<T>(fn: () => Promise<SdkResult<T>>): Promise<SdkResult<T>> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await fn();
    if (!result.error) return result;

    const retryable = result.error.name && RETRYABLE_ERRORS.has(result.error.name);
    if (!retryable || attempt === MAX_RETRIES) return result;

    // Exponential backoff: 1s, 2s, 4s. Matches Resend's skill recommendation.
    await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
  }
  return { data: null, error: { name: "api_error", message: "retry budget exhausted" } };
}

function formatError(err: { name?: string; message: string }): string {
  return err.name ? `Resend ${err.name}: ${err.message}` : `Resend error: ${err.message}`;
}

// ─── Email Provider Implementation ──────────────────────────────────────────

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  async send(
    params: EmailParams & { scheduledAt?: string; idempotencyKey?: string },
  ): Promise<EmailResult> {
    const payload: Parameters<typeof Resend.prototype.emails.send>[0] = {
      from: params.from ?? DEFAULT_FROM,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      ...(params.text ? { text: params.text } : {}),
      ...(params.replyTo ? { replyTo: params.replyTo } : {}),
      ...(params.tags?.length ? { tags: params.tags } : {}),
      ...(params.headers && Object.keys(params.headers).length > 0
        ? { headers: params.headers }
        : {}),
      ...(params.scheduledAt ? { scheduledAt: params.scheduledAt } : {}),
      ...(params.attachments?.length
        ? {
            attachments: params.attachments.map((a) => ({
              content: a.content,
              filename: a.filename,
              contentType: a.contentType,
            })),
          }
        : {}),
    };

    const result = await withRetry(() =>
      getSdk().emails.send(
        payload,
        params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined,
      ),
    );

    if (result.error) {
      return { success: false, error: formatError(result.error) };
    }
    return { success: true, messageId: result.data?.id };
  }

  /**
   * Send up to 100 transactional emails per call via POST /emails/batch.
   *
   * Constraints (from Resend docs):
   * - No attachments (stripped silently — batch rejects them otherwise)
   * - No scheduled_at (ignored — caller should use single send for scheduling)
   * - Batch is atomic: any per-email validation failure fails the whole
   *   batch, so we keep pre-send validation at the service layer (where
   *   we have typed inputs) rather than here.
   *
   * Use this for transactional fan-out (organizer broadcasts, event-cancel
   * notifications). Do NOT use for marketing — newsletters must go through
   * createAndSendBroadcast against a Segment so Resend handles unsubscribe.
   */
  async sendBulk(params: EmailParams[], options?: BulkSendOptions): Promise<BulkEmailResult> {
    const results: EmailResult[] = [];
    let sent = 0;
    let failed = 0;

    const BATCH_SIZE = 100;
    for (let i = 0; i < params.length; i += BATCH_SIZE) {
      const chunk = params.slice(i, i + BATCH_SIZE);

      const batchPayload = chunk.map((p) => ({
        from: p.from ?? DEFAULT_FROM,
        to: [p.to],
        subject: p.subject,
        html: p.html,
        ...(p.text ? { text: p.text } : {}),
        ...(p.replyTo ? { replyTo: p.replyTo } : {}),
        ...(p.tags?.length ? { tags: p.tags } : {}),
        ...(p.headers && Object.keys(p.headers).length > 0 ? { headers: p.headers } : {}),
        // Deliberately no attachments / scheduled_at — batch rejects both.
      }));

      // Scope the idempotency key per chunk so retrying one chunk doesn't
      // collide with a different chunk's payload (Resend returns 409 if
      // the same key is reused with a different payload).
      const chunkIdempotency = options?.idempotencyKey
        ? `${options.idempotencyKey}/chunk-${Math.floor(i / BATCH_SIZE)}`
        : undefined;

      const result = await withRetry(() =>
        getSdk().batch.send(
          batchPayload,
          chunkIdempotency ? { idempotencyKey: chunkIdempotency } : undefined,
        ),
      );

      if (result.error) {
        const errMsg = formatError(result.error);
        for (const _p of chunk) {
          results.push({ success: false, error: errMsg });
          failed++;
        }
        continue;
      }

      const ids = (result.data as { data?: { id: string }[] } | null)?.data ?? [];
      for (const item of ids) {
        results.push({ success: true, messageId: item.id });
        sent++;
      }
    }

    return { total: params.length, sent, failed, results };
  }

  // ─── Broadcasts ───────────────────────────────────────────────────────────
  //
  // Marketing path. Broadcasts target a Segment; Resend injects the
  // one-click List-Unsubscribe header, hosts the unsubscribe endpoint, and
  // skips contacts with `unsubscribed: true` automatically.
  //
  // We create + send in one call via `send: true`. The service layer is
  // responsible for including `{{{RESEND_UNSUBSCRIBE_URL}}}` in the HTML
  // body so Resend can substitute the per-recipient unsubscribe link.

  async createAndSendBroadcast(input: ResendBroadcastInput): Promise<ResendBroadcastResult> {
    const payload: Parameters<typeof Resend.prototype.broadcasts.create>[0] = {
      name: input.name ?? input.subject.slice(0, 100),
      from: input.from,
      subject: input.subject,
      html: input.html,
      segmentId: input.segmentId,
      send: true,
      ...(input.text ? { text: input.text } : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
    };

    const result = await withRetry(() => getSdk().broadcasts.create(payload));

    if (result.error) {
      return { success: false, error: formatError(result.error) };
    }
    return { success: true, broadcastId: result.data?.id };
  }

  // ─── Contacts (newsletter subscribers mirror) ───────────────────────────

  /**
   * Create a contact and assign it to the newsletter segment in one call.
   * 409 (email already in the account) is treated as success so the call
   * is safe to re-run for existing subscribers.
   */
  async createContact(
    segmentId: string,
    contact: ResendContactInput,
  ): Promise<ResendContactResult> {
    const result = await withRetry(() =>
      getSdk().contacts.create({
        email: contact.email,
        ...(contact.firstName !== undefined ? { firstName: contact.firstName } : {}),
        ...(contact.lastName !== undefined ? { lastName: contact.lastName } : {}),
        ...(contact.unsubscribed !== undefined ? { unsubscribed: contact.unsubscribed } : {}),
        segments: [{ id: segmentId }],
      }),
    );

    if (result.error) {
      // Duplicate contact is a no-op for our purposes — the user is already
      // in the segment, that's the desired state.
      if (
        result.error.name === "invalid_idempotent_request" ||
        /already exists|duplicate/i.test(result.error.message)
      ) {
        return { success: true, alreadyExists: true };
      }
      return { success: false, error: formatError(result.error) };
    }
    return { success: true, contactId: result.data?.id };
  }

  /**
   * Flip a contact to unsubscribed without deleting it, preserving history
   * and preventing accidental re-subscription from stale imports.
   */
  async unsubscribeContact(email: string): Promise<ResendContactResult> {
    const result = await withRetry(() => getSdk().contacts.update({ email, unsubscribed: true }));

    if (result.error) {
      return { success: false, error: formatError(result.error) };
    }
    return { success: true };
  }
}

export const resendEmailProvider = new ResendEmailProvider();
