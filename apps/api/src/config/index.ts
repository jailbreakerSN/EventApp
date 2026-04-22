import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "staging", "production"]).default("development"),
  LOG_LEVEL: z.enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  FIREBASE_PROJECT_ID: z
    .string()
    .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, "Invalid Firebase project ID format"),
  FIREBASE_STORAGE_BUCKET: z.string(),

  CORS_ORIGINS: z.string().transform((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ),

  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),

  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_NAME: z.string().default("Teranga Events"),

  // Legacy single-sender fallback — kept so existing environments stay green.
  // New code should resolve senders via the EmailCategory registry; this value
  // is only used when a category-specific var is unset. Default updated
  // from no-reply@ to events@ in lockstep with the sender registry
  // change — see the RESEND_FROM_EVENTS docstring below.
  RESEND_FROM_EMAIL: z.string().default("events@terangaevent.com"),

  // Per-category From addresses. Each maps to an EmailCategory in
  // packages/shared-types/src/communication.types.ts via the sender registry.
  //
  // Why not `no-reply@`: Resend's deliverability analyzer and the
  // Gmail/Yahoo/Microsoft bulk-sender guidelines all flag no-reply
  // addresses. Users who hit reply hit a wall (bad UX), and mailbox
  // providers treat domains that only ever send from no-reply as
  // lower trust. We route `auth` + `transactional` through `events@`
  // — a real, addressable mailbox — with Reply-To to `support@` so
  // replies land somewhere useful.
  RESEND_FROM_EVENTS: z.string().default("events@terangaevent.com"),
  RESEND_FROM_HELLO: z.string().default("hello@terangaevent.com"),
  RESEND_FROM_BILLING: z.string().default("billing@terangaevent.com"),
  RESEND_FROM_NEWS: z.string().default("news@terangaevent.com"),

  // Reply-To addresses. These should be real inboxes (Google Workspace, etc.)
  // — Resend is outbound-only, so replies bounce unless the MX points elsewhere.
  RESEND_REPLY_TO_SUPPORT: z.string().default("support@terangaevent.com"),
  RESEND_REPLY_TO_BILLING: z.string().default("billing@terangaevent.com"),
  RESEND_REPLY_TO_CONTACT: z.string().default("contact@terangaevent.com"),

  // Resend Segment backing the newsletter (Resend renamed "Audiences" to
  // "Segments"). Newsletter subscribers are mirrored into this segment so
  // `POST /broadcasts` has recipients and Resend can manage the unsubscribe
  // flow automatically (List-Unsubscribe + one-click RFC 8058). Create the
  // segment once in the Resend dashboard and paste the id here. Leaving it
  // unset keeps the newsletter path dormant — subscribe still writes to
  // Firestore; sendNewsletter no-ops rather than erroring.
  RESEND_NEWSLETTER_SEGMENT_ID: z.string().optional(),

  AT_API_KEY: z.string().optional(),
  AT_USERNAME: z.string().default("sandbox"),
  AT_SENDER_ID: z.string().default("Teranga"),

  // ─── Public URLs (used to build absolute links in emails, payment ───────
  // callbacks, etc.). Every URL the API emits into an email or hands to a
  // payment provider is built from one of these three — see
  // apps/api/src/config/public-urls.ts. When the domain changes, updating
  // the corresponding Cloud Run env var (no code change) is sufficient.
  //
  // Defaults match the local dev emulator ports so `npm run api:dev` +
  // `npm run web:dev` work without any extra .env setup. Prod MUST
  // override all three.

  // Public base URL the API serves under. Used to build absolute links in
  // transactional emails (newsletter confirm, unsubscribe), payment
  // webhook callbacks, and the mock checkout redirect.
  API_BASE_URL: z.string().url().default("http://localhost:3000"),
  // Public base URL for the participant web app (Next.js). Used to build
  // the default paymentReturnUrl and any "view in app" links in emails.
  PARTICIPANT_WEB_URL: z.string().url().default("http://localhost:3002"),
  // Public base URL for the organizer back-office web app (Next.js).
  // Used by the return-URL allowlist so a back-office-initiated checkout
  // can redirect back to the admin surface after payment.
  WEB_BACKOFFICE_URL: z.string().url().default("http://localhost:3001"),

  // HMAC secret for stateless newsletter confirmation tokens. Separate from
  // QR_SECRET on purpose — a compromise of one cryptographic domain must
  // not compromise the other. 32+ chars; see services/newsletter/
  // confirmation-token.ts for the format.
  NEWSLETTER_CONFIRM_SECRET: z
    .string()
    .min(32, "NEWSLETTER_CONFIRM_SECRET must be at least 32 characters")
    .default("dev-newsletter-confirm-secret-change-me-in-prod-3cd2"),

  // HMAC secret for the subscriber-facing unsubscribe link shipped in
  // non-mandatory transactional emails (List-Unsubscribe header + one-
  // click POST per RFC 8058). Separate from the newsletter confirm
  // secret — compromising one must not compromise the other. Tokens do
  // not expire: users click old emails months later and it still works.
  //
  // Rotation: see the "ROTATION RUNBOOK" block in .env.example. Short
  // version — rotating this secret in prod invalidates every
  // outstanding unsubscribe link at once, which is a compliance +
  // deliverability event. Coordinate via the operations channel before
  // rotating.
  UNSUBSCRIBE_SECRET: z
    .string()
    .min(32, "UNSUBSCRIBE_SECRET must be at least 32 characters")
    .default("dev-unsubscribe-secret-change-me-in-prod-3c-4-1234"),

  QR_SECRET: z.string().min(32, "QR_SECRET must be at least 32 characters"),
  // v4 QR signing derives per-event HMAC keys via HKDF-SHA256(QR_MASTER,
  // salt=eventId, info=`teranga/qr/v4/${kid}`). Keeping it separate from
  // QR_SECRET means we can roll out v4 without touching the v3 key path
  // and rotate the v4 master independently. Optional during the rollout
  // window; when unset, v4 signing falls back to QR_SECRET so existing
  // deployments stay green — production should set it explicitly before
  // any event flips to v4 issuance.
  QR_MASTER: z.string().min(32, "QR_MASTER must be at least 32 characters").optional(),
  WEBHOOK_SECRET: z.string().min(16).default("dev-webhook-secret-change-in-prod"),

  // ─── Observability (optional) ──────────────────────────────────────────────
  // GitHub Actions injects `${{ secrets.SENTRY_DSN }}` as an empty string when
  // the secret is unset — preprocess converts that back to undefined so the
  // URL validator doesn't reject it.
  SENTRY_DSN: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().url().optional(),
  ),

  // ─── Notification system rollout flag (Phase 1) ──────────────────────────
  // When enabled the 10 existing emailService.sendXxx helpers route through
  // the NotificationService dispatcher (catalog lookup, admin kill-switch,
  // per-key user opt-out, audit trail). When disabled the legacy code path
  // runs unchanged. Default OFF in production; dev + staging bake it ON via
  // the platform config so we get observability from day one. See
  // docs/notification-system-roadmap.md Phase 1.
  NOTIFICATIONS_DISPATCHER_ENABLED: z.preprocess(
    (v) => (typeof v === "string" ? v.toLowerCase() === "true" || v === "1" : v),
    z.boolean().default(false),
  ),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
