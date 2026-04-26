/**
 * Organizer overhaul — Phase O6.
 *
 * WhatsApp Business Cloud API integration types.
 *
 * Why a dedicated types file (vs. extending `communication.types.ts`)?
 *
 *  - WhatsApp's contract is fundamentally different from email/SMS:
 *    every message must reference a Meta-pre-approved template, the
 *    delivery webhook returns 4 distinct status states, and consent
 *    must be explicit (Meta policy + GDPR).
 *  - Isolating the types here keeps the channel adapter swappable
 *    (Meta Cloud API today, Africa's Talking tomorrow if pricing /
 *    deliverability shifts).
 *  - The opt-in shape lives here so the participant's consent record
 *    is co-located with the channel that needs it, not buried in
 *    `notification-preferences`.
 *
 * Adapter pattern: the API ships with a default `MockWhatsAppTransport`
 * (logs payloads + returns a deterministic id) until Meta Business
 * homologation aboutit. Production binds the real `MetaCloudTransport`
 * via DI in `app.ts`. The contract stays identical.
 */

import { z } from "zod";

// ─── Meta-template lifecycle (mirror of the Cloud API states) ──────────────

export const WhatsappTemplateStatusSchema = z.enum([
  "draft", // local, never submitted
  "pending", // submitted to Meta, awaiting approval
  "approved", // ready to send
  "rejected", // refused by Meta (reason string carried separately)
  "paused", // temporarily disabled (rate-limited or paused by user)
]);
export type WhatsappTemplateStatus = z.infer<typeof WhatsappTemplateStatusSchema>;

/**
 * Meta Cloud API forces every outbound WhatsApp message to map to a
 * pre-approved template. Our local registry of those templates carries:
 *   - `id`            — local stable identifier;
 *   - `metaName`      — the name registered with Meta (used by the API);
 *   - `language`      — BCP-47 tag (`fr`, `wo`, `en`);
 *   - `bodyPreview`   — readable copy for the composer (variables in
 *                       `{{1}}`, `{{2}}` Meta-style — Meta uses positional
 *                       placeholders, NOT named ones);
 *   - `variableCount` — how many positional `{{N}}` placeholders the body
 *                       expects (validated server-side at send time).
 *   - `status`        — current lifecycle state.
 *
 * The seed registry below ships with 3 starter templates. New templates
 * land via a future admin UI + Meta submission flow (out of O6 scope).
 */
export const WhatsappTemplateSchema = z.object({
  id: z.string(),
  metaName: z.string().min(1).max(100),
  language: z.string().min(2).max(10),
  bodyPreview: z.string().min(1).max(2000),
  variableCount: z.number().int().min(0).max(10),
  status: WhatsappTemplateStatusSchema,
  /** Why a `rejected` template was refused — surfaced to the operator. */
  rejectionReason: z.string().nullable().optional(),
});
export type WhatsappTemplate = z.infer<typeof WhatsappTemplateSchema>;

/**
 * Starter templates pre-registered for the Teranga Meta Business
 * account. The list is intentionally narrow — Meta's approval cycle
 * is slow (24-48 h per template) and broadcast-quality copy beats
 * volume.
 *
 * Variable conventions:
 *   `{{1}}` = participant first name
 *   `{{2}}` = event title
 *   `{{3}}` = event date (FR long form, e.g. "12 mai 2026")
 */
export const SEED_WHATSAPP_TEMPLATES: readonly WhatsappTemplate[] = [
  {
    id: "wa-reminder-j1",
    metaName: "teranga_reminder_j1_fr",
    language: "fr",
    bodyPreview:
      "Bonjour {{1}}, c'est demain ! {{2}} se tient le {{3}}. Préparez votre badge dans l'application Teranga avant votre arrivée. À très bientôt.",
    variableCount: 3,
    status: "approved",
  },
  {
    id: "wa-confirmation-registration",
    metaName: "teranga_confirmation_registration_fr",
    language: "fr",
    bodyPreview:
      "Bonjour {{1}}, votre inscription à {{2}} (le {{3}}) est confirmée. Merci de votre confiance.",
    variableCount: 3,
    status: "approved",
  },
  {
    id: "wa-confirmation-payment",
    metaName: "teranga_confirmation_payment_fr",
    language: "fr",
    bodyPreview:
      "Bonjour {{1}}, nous confirmons la réception de votre paiement pour {{2}}. Votre reçu est disponible dans votre espace personnel.",
    variableCount: 2,
    status: "approved",
  },
];

// ─── Participant opt-in record ─────────────────────────────────────────────
//
// One document per (userId, organizationId) pair. Stored in a dedicated
// `whatsappOptIns` collection — not on the user doc — because:
//  - org-scoped: a participant inscribed at two organisations may opt in
//    to one and not the other;
//  - audit-friendly: every opt / opt-out write produces a self-contained
//    audit log entry referencing the document id.
//
// Meta requires explicit, recorded consent BEFORE the first template
// send. The `acceptedAt` timestamp is the legal proof; the UA + IP
// are not stored at this stage to minimise PII surface (a follow-up
// may add them once the legal team signs off).

export const WhatsappOptInStatusSchema = z.enum(["opted_in", "revoked"]);
export type WhatsappOptInStatus = z.infer<typeof WhatsappOptInStatusSchema>;

export const WhatsappOptInSchema = z.object({
  id: z.string(),
  userId: z.string(),
  organizationId: z.string(),
  /**
   * E.164 phone number used for delivery (`+221...`). Captured at
   * opt-in time; later edits emit a fresh opt-in record for the new
   * number rather than mutating the existing one.
   */
  phoneE164: z.string().regex(/^\+\d{6,15}$/, "Phone must be E.164"),
  status: WhatsappOptInStatusSchema,
  acceptedAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WhatsappOptIn = z.infer<typeof WhatsappOptInSchema>;

export const CreateWhatsappOptInSchema = z.object({
  organizationId: z.string(),
  phoneE164: z.string().regex(/^\+\d{6,15}$/, "Phone must be E.164"),
});
export type CreateWhatsappOptInDto = z.infer<typeof CreateWhatsappOptInSchema>;

// ─── Delivery webhook payload (Meta-emit) ─────────────────────────────────

/**
 * Mirror of the subset of Meta Cloud API webhook fields we care about.
 * The full payload is much larger (contacts, conversation pricing,
 * errors); we keep the DTO narrow to what feeds our internal status
 * tracking.
 */
export const WhatsappDeliveryStatusSchema = z.enum(["sent", "delivered", "read", "failed"]);
export type WhatsappDeliveryStatus = z.infer<typeof WhatsappDeliveryStatusSchema>;

export const WhatsappDeliveryWebhookSchema = z.object({
  /** Meta's message id — primary key for status updates. */
  messageId: z.string().min(1).max(200),
  status: WhatsappDeliveryStatusSchema,
  /** Recipient E.164 phone number. */
  recipient: z.string().regex(/^\+\d{6,15}$/),
  /** Epoch seconds (Meta convention). */
  timestamp: z.number().int().positive(),
  /** Optional error code Meta returns on `failed`. */
  errorCode: z.string().max(50).nullable().optional(),
  /** Optional human-readable error. */
  errorMessage: z.string().max(500).nullable().optional(),
});
export type WhatsappDeliveryWebhook = z.infer<typeof WhatsappDeliveryWebhookSchema>;

// ─── Send DTO (organizer → adapter) ────────────────────────────────────────

/**
 * What the broadcast service hands the WhatsApp adapter when a
 * `whatsapp` channel is selected on a broadcast. The composer's
 * `body` field is NOT sent verbatim — Meta requires a template
 * reference + positional variables. The mapping is computed by the
 * adapter at send-time.
 */
export const WhatsappSendRequestSchema = z.object({
  /** Local template id (from `SEED_WHATSAPP_TEMPLATES`). */
  templateId: z.string(),
  /** Recipient E.164 phone number — caller MUST verify opt-in first. */
  to: z.string().regex(/^\+\d{6,15}$/),
  /** Positional variables matching the template's `variableCount`. */
  variables: z.array(z.string().max(500)),
});
export type WhatsappSendRequest = z.infer<typeof WhatsappSendRequestSchema>;

export interface WhatsappSendResult {
  /** Meta message id (or mock id with `mock-` prefix in dev). */
  messageId: string;
  /** Was the send accepted by Meta (or mocked)? */
  accepted: boolean;
}
