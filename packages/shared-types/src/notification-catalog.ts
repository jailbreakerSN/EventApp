import { z } from "zod";

// ─── Notification Catalog ──────────────────────────────────────────────────
// Declarative definition of every notification the platform can send.
//
// This file is the single source of truth consumed by:
//   - The API's NotificationService dispatcher (apps/api/src/services/
//     notification.service.ts) — looks up a definition by `key` on every
//     send to resolve channels, user-opt-out rules, and templates.
//   - The super-admin UI (apps/web-backoffice/src/app/(dashboard)/admin/
//     notifications/) — lists every definition so an admin can flip the
//     enabled / channels / subject-override Firestore settings without a
//     code deploy.
//   - The end-user preferences page — enumerates keys the user is allowed
//     to opt out of (everything where `userOptOutAllowed === true`).
//
// Adding a notification = add one entry to NOTIFICATION_CATALOG. The
// dispatcher discovers it automatically; no wiring elsewhere.
//
// The catalog lives in `shared-types` (not in apps/api) so the backoffice
// web app can import the exact same entries without pulling Node-only code.

// ─── Locale ────────────────────────────────────────────────────────────────
// Re-uses the same 3-locale set as users/venues (fr / en / wo). Kept local
// to the notification catalog so consumers can import it without crossing
// the user schema boundary — the equivalent enum already exists on
// UserSchema.preferredLanguage, and this stays aligned with it.

export const NotificationLocaleSchema = z.enum(["fr", "en", "wo"]);
export type NotificationLocale = z.infer<typeof NotificationLocaleSchema>;

/**
 * Translated string for every supported locale. Every field is required —
 * missing a locale is a compile error. Mirrors the email i18n Dictionary
 * pattern (apps/api/src/services/email/i18n/dictionary.ts).
 */
export const I18nStringSchema = z.object({
  fr: z.string(),
  en: z.string(),
  wo: z.string(),
});

export type I18nString = z.infer<typeof I18nStringSchema>;

// ─── Channels & Categories ─────────────────────────────────────────────────

export const NotificationChannelSchema = z.enum(["email", "sms", "push", "in_app"]);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

/**
 * User-preference bucket AND security/transactional classification.
 *
 * `auth` + `billing` are treated as mandatory — users cannot opt out, the
 * dispatcher ignores per-key toggles for these. See dispatcher algorithm
 * in docs/notification-system-architecture.md §7.
 */
export const NotificationCategorySchema = z.enum([
  "auth",
  "transactional",
  "organizational",
  "billing",
  "marketing",
]);
export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;

/**
 * Who receives the notification. Most entries use one of the standard
 * resolvers; `custom` hands the listener full control (passes recipients
 * explicitly in DispatchRequest.recipients).
 */
export const NotificationRecipientResolverSchema = z.enum([
  "self",
  "org-owners",
  "org-billing",
  "event-organizer",
  "custom",
]);
export type NotificationRecipientResolver = z.infer<typeof NotificationRecipientResolverSchema>;

/**
 * Scope controls visibility in the super-admin UI and whether a setting
 * can be overridden per-org in v2. For v1 every setting is platform-wide.
 */
export const NotificationScopeSchema = z.enum(["platform", "organization", "event"]);
export type NotificationScope = z.infer<typeof NotificationScopeSchema>;

// ─── Definition ────────────────────────────────────────────────────────────

export const NotificationDefinitionSchema = z.object({
  /**
   * Stable notification key, e.g. "registration.created". Never change once
   * live — it's the primary key for admin overrides, user preferences, and
   * audit logs. Dot-prefix groups related keys so the admin UI can display
   * them together.
   */
  key: z.string().min(1),
  category: NotificationCategorySchema,
  displayName: I18nStringSchema,
  description: I18nStringSchema,
  /** Channels the template/code path supports today. */
  supportedChannels: z.array(NotificationChannelSchema).min(1),
  /** Channels emitted when the admin hasn't overridden. Must ⊂ supportedChannels. */
  defaultChannels: z.array(NotificationChannelSchema).min(1),
  /**
   * If false the dispatcher ignores user opt-out. Security / transactional
   * (auth, payment.failed, refund.*, password.changed, email.changed) must
   * ship regardless of preference — users can't debug billing failures if
   * the platform silently dropped them.
   */
  userOptOutAllowed: z.boolean(),
  /**
   * Template id per channel. The email channel resolves this to a
   * react-email builder in apps/api/src/services/email/templates/. Other
   * channels are stubs in v1 (populated in Phase 6).
   */
  templates: z.record(NotificationChannelSchema, z.string()),
  /** Driving domain event name (see apps/api/src/events/domain-events.ts). */
  triggerDomainEvent: z.string().min(1),
  recipientResolver: NotificationRecipientResolverSchema,
  scope: NotificationScopeSchema,
});

export type NotificationDefinition = z.infer<typeof NotificationDefinitionSchema>;

// ─── Admin Setting ─────────────────────────────────────────────────────────
// Per-key Firestore override. Absent doc = use catalog defaults.

export const NotificationSettingSchema = z.object({
  /** Matches NotificationDefinition.key. Doc id in Firestore. */
  key: z.string().min(1),
  /**
   * Phase 2.4 — when present, this override applies only to the given
   * organization. Null/omitted = platform-wide override. The dispatcher
   * resolves per-org first, then falls back to platform, then the catalog
   * default (see apps/api/src/services/notifications/setting-resolution.ts).
   *
   * Doc id layout:
   *   - platform: `{key}` (back-compat with v1 docs written before this field)
   *   - per-org:  `{key}__{organizationId}`
   */
  organizationId: z.string().min(1).nullable().optional(),
  enabled: z.boolean(),
  channels: z.array(NotificationChannelSchema),
  subjectOverride: I18nStringSchema.optional(),
  updatedAt: z.string().datetime(),
  updatedBy: z.string().min(1),
});

export type NotificationSetting = z.infer<typeof NotificationSettingSchema>;

/**
 * Phase 2.4 — append-only edit history for NotificationSetting docs.
 * One entry per PUT (admin or organizer), used by the admin UI's history
 * panel. Retention target: 1 year TTL (Firestore TTL config tracked as a
 * follow-up ticket — the collection is declared in COLLECTIONS so any
 * future TTL tooling can reference it by name).
 */
export const NotificationSettingHistorySchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  organizationId: z.string().min(1).nullable(),
  /**
   * Snapshot of the setting before this edit, or null for the very first
   * write (no prior platform or org override existed).
   */
  previousValue: NotificationSettingSchema.nullable(),
  /** Snapshot of the setting after this edit. */
  newValue: NotificationSettingSchema,
  /**
   * Machine-readable diff — lists the top-level fields that changed
   * between previousValue and newValue. Empty array = no-op write (kept
   * for forensic completeness, should never happen in practice).
   */
  diff: z.array(z.string()),
  actorId: z.string().min(1),
  /** Role of the actor at the time of the write — "super_admin" or "organizer". */
  actorRole: z.string().min(1),
  /** Optional free-text reason for the change (admin UI form field). */
  reason: z.string().optional(),
  changedAt: z.string().datetime(),
});

export type NotificationSettingHistory = z.infer<typeof NotificationSettingHistorySchema>;

// ─── Dispatcher Input ──────────────────────────────────────────────────────

export const NotificationRecipientSchema = z.object({
  userId: z.string().optional(),
  email: z.string().email().optional(),
  /** Future — SMS channel. */
  phone: z.string().optional(),
  /** Future — push channel. */
  fcmTokens: z.array(z.string()).optional(),
  preferredLocale: NotificationLocaleSchema,
});

export type NotificationRecipient = z.infer<typeof NotificationRecipientSchema>;

/**
 * Input to NotificationService.dispatch. Generic over the template params
 * shape — each listener passes the exact params its template expects.
 */
export interface DispatchRequest<P extends Record<string, unknown> = Record<string, unknown>> {
  key: string;
  recipients: NotificationRecipient[];
  params: P;
  /**
   * Dedup window key. The dispatcher hashes `${key}:${userId|email}:${idempotencyKey}`
   * and passes it through to the provider's idempotency machinery
   * (existing Resend integration). Omit to auto-derive from a stable
   * subset of params.
   */
  idempotencyKey?: string;
  /** Force a channel subset — used for admin "test send" flows. */
  channelOverride?: NotificationChannel[];
  /**
   * Phase 2.4 — admin "test send" flag. When true the dispatcher:
   *   - Bypasses the admin-disabled short-circuit.
   *   - Bypasses user opt-out (test sends target admin-entered addresses).
   *   - Bypasses the suppression list (admin typed this address explicitly).
   *   - Skips the persistent-dedup window (every test send is unique).
   *   - Emits `notification.test_sent` instead of `notification.sent` so
   *     the audit trail flags these as out-of-band previews and the
   *     Phase 5 dispatch-log stats stay accurate.
   */
  testMode?: boolean;
}

// ─── Suppression reasons ───────────────────────────────────────────────────
// Used by the dispatcher when emitting `notification.suppressed` audit
// events. Keep in lockstep with audit.types.ts and architecture doc §7.

export const NotificationSuppressionReasonSchema = z.enum([
  "admin_disabled",
  "user_opted_out",
  "on_suppression_list",
  "bounced",
  "no_recipient",
]);
export type NotificationSuppressionReason = z.infer<typeof NotificationSuppressionReasonSchema>;

// ─── Catalog ───────────────────────────────────────────────────────────────
// Seeded with the 10 notifications already shipped in
// apps/api/src/services/email.service.ts (lines 402-524). Adding a new
// notification = push a new entry here + ship its template + listener.
// See docs/notification-system-roadmap.md Phase 2 for the gap list.

export const NOTIFICATION_CATALOG: readonly NotificationDefinition[] = [
  // ─── Auth (user-opt-out forbidden) ─────────────────────────────────────
  {
    key: "auth.email_verification",
    category: "auth",
    displayName: {
      fr: "Vérification de l'adresse e-mail",
      en: "Email address verification",
      wo: "Ñu dëggal adress e-mail",
    },
    description: {
      fr: "Envoyé à la création du compte et sur demande de renvoi.",
      en: "Sent at sign-up and on user-initiated resend.",
      wo: "Yeboo ci sign-up bi ak bu ko jëfandikukat bi ñaan.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "EmailVerification" },
    triggerDomainEvent: "auth.email_verification_requested",
    recipientResolver: "self",
    scope: "platform",
  },
  {
    key: "auth.password_reset",
    category: "auth",
    displayName: {
      fr: "Réinitialisation du mot de passe",
      en: "Password reset",
      wo: "Soppi mot de passe",
    },
    description: {
      fr: "Envoyé depuis la page « mot de passe oublié ».",
      en: "Sent from the forgot-password page.",
      wo: "Yeboo ci page « mot de passe fàtte ».",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "PasswordReset" },
    triggerDomainEvent: "auth.password_reset_requested",
    recipientResolver: "self",
    scope: "platform",
  },

  // ─── Transactional (event lifecycle) ───────────────────────────────────
  {
    key: "registration.created",
    category: "transactional",
    displayName: {
      fr: "Confirmation d'inscription",
      en: "Registration confirmation",
      wo: "Kàggu inscription",
    },
    description: {
      fr: "Confirme l'inscription à un événement.",
      en: "Confirms a successful event registration.",
      wo: "Dëggal inscription ci benn événement.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "RegistrationConfirmation" },
    triggerDomainEvent: "registration.created",
    recipientResolver: "self",
    scope: "event",
  },
  {
    key: "registration.approved",
    category: "transactional",
    displayName: {
      fr: "Inscription approuvée",
      en: "Registration approved",
      wo: "Inscription nangu",
    },
    description: {
      fr: "Envoyé quand l'organisateur approuve une inscription en attente.",
      en: "Sent when the organiser approves a pending registration.",
      wo: "Yeboo bu organisateur bi nangu inscription bi.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "RegistrationApproved" },
    triggerDomainEvent: "registration.approved",
    recipientResolver: "self",
    scope: "event",
  },
  {
    key: "badge.ready",
    category: "transactional",
    displayName: {
      fr: "Badge prêt",
      en: "Badge ready",
      wo: "Badge wóor",
    },
    description: {
      fr: "Le PDF du badge a été généré et est disponible au téléchargement.",
      en: "The badge PDF has been generated and is available to download.",
      wo: "Badge PDF bi, génëree, te mën nañu ko download.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "BadgeReady" },
    triggerDomainEvent: "badge.generated",
    recipientResolver: "self",
    scope: "event",
  },
  {
    key: "event.cancelled",
    category: "transactional",
    displayName: {
      fr: "Événement annulé",
      en: "Event cancelled",
      wo: "Événement neenal",
    },
    description: {
      fr: "Envoyé à tous les inscrits quand l'organisateur annule un événement.",
      en: "Sent to every registrant when the organiser cancels an event.",
      wo: "Yeboo ci ñépp ñu bind, bu organisateur bi neenal événement bi.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "EventCancelled" },
    triggerDomainEvent: "event.cancelled",
    recipientResolver: "custom",
    scope: "event",
  },
  {
    key: "event.reminder",
    category: "transactional",
    displayName: {
      fr: "Rappel 24h avant l'événement",
      en: "24h event reminder",
      wo: "Fàttaliku 24h laata",
    },
    description: {
      fr: "Envoyé automatiquement 24h avant le début d'un événement.",
      en: "Sent automatically 24h before an event starts.",
      wo: "Yeboo 24h laata event bi tàmbalee.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: true,
    templates: { email: "EventReminder" },
    triggerDomainEvent: "event.reminder_due",
    recipientResolver: "custom",
    scope: "event",
  },

  // ─── Billing (mandatory) ───────────────────────────────────────────────
  {
    key: "payment.succeeded",
    category: "billing",
    displayName: {
      fr: "Reçu de paiement",
      en: "Payment receipt",
      wo: "Kàggu paiement",
    },
    description: {
      fr: "Reçu transactionnel envoyé après un paiement réussi.",
      en: "Transactional receipt sent after a successful payment.",
      wo: "Kàggu bu yëk ci bees paiement mu sax.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "PaymentReceipt" },
    triggerDomainEvent: "payment.succeeded",
    recipientResolver: "self",
    scope: "event",
  },

  // ─── Marketing (user-opt-out allowed) ──────────────────────────────────
  {
    key: "newsletter.confirm",
    category: "transactional",
    displayName: {
      fr: "Confirmation d'abonnement à la newsletter",
      en: "Newsletter subscribe confirmation",
      wo: "Dëggal newsletter",
    },
    description: {
      fr: "Double-opt-in envoyé après la soumission du formulaire d'abonnement.",
      en: "Double-opt-in sent after the subscribe form is submitted.",
      wo: "Yeboo ginnaaw formulaire d'inscription bi.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "NewsletterConfirmation" },
    triggerDomainEvent: "newsletter.subscriber_created",
    recipientResolver: "custom",
    scope: "platform",
  },
  {
    key: "newsletter.welcome",
    category: "marketing",
    displayName: {
      fr: "Bienvenue dans la newsletter",
      en: "Newsletter welcome",
      wo: "Dalal ak diam ci newsletter",
    },
    description: {
      fr: "Envoyé après la confirmation du double-opt-in.",
      en: "Sent after the double-opt-in is confirmed.",
      wo: "Yeboo ginnaaw dëggal double-opt-in.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: true,
    templates: { email: "NewsletterWelcome" },
    triggerDomainEvent: "newsletter.subscriber_confirmed",
    recipientResolver: "custom",
    scope: "platform",
  },

  // ─── Phase 2 P0 — revenue- and security-critical gaps ──────────────────
  {
    key: "payment.failed",
    category: "billing",
    displayName: {
      fr: "Paiement échoué",
      en: "Payment failed",
      wo: "Paiement jappul",
    },
    description: {
      fr: "Envoyé quand un paiement est rejeté par l'opérateur (Wave, Orange Money, carte).",
      en: "Sent when a payment is declined by the provider (Wave, Orange Money, card).",
      wo: "Yeboo su paiement jappul ci operateur bi.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "PaymentFailed" },
    triggerDomainEvent: "payment.failed",
    recipientResolver: "self",
    scope: "event",
  },
  {
    key: "invite.sent",
    category: "transactional",
    displayName: {
      fr: "Invitation envoyée",
      en: "Invite sent",
      wo: "Ndigël jaayi",
    },
    description: {
      fr: "Email à la personne invitée (co-organisateur, intervenant, sponsor, staff).",
      en: "Email to the invitee (co-organizer, speaker, sponsor, staff).",
      wo: "Imayil ci nit ki ñuy ndigël.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "InviteSent" },
    triggerDomainEvent: "invite.created",
    recipientResolver: "custom",
    scope: "organization",
  },
  {
    key: "registration.cancelled",
    category: "transactional",
    displayName: {
      fr: "Inscription annulée",
      en: "Registration cancelled",
      wo: "Inscription neenal",
    },
    description: {
      fr: "Confirme l'annulation d'une inscription (par le participant ou l'organisateur).",
      en: "Confirms a registration cancellation (by the participant or the organiser).",
      wo: "Dëggal ne inscription bi neenal nañ ko.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "RegistrationCancelled" },
    triggerDomainEvent: "registration.cancelled",
    recipientResolver: "self",
    scope: "event",
  },
  {
    key: "event.rescheduled",
    category: "transactional",
    displayName: {
      fr: "Événement reprogrammé",
      en: "Event rescheduled",
      wo: "Événement bi soppeeku na",
    },
    description: {
      fr: "Envoyé à tous les inscrits quand la date d'un événement change.",
      en: "Sent to every registrant when an event's dates change.",
      wo: "Yeboo ci ñépp ñu bind bu date bi soppeeku.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "EventRescheduled" },
    triggerDomainEvent: "event.updated",
    recipientResolver: "custom",
    scope: "event",
  },
  {
    key: "subscription.past_due",
    category: "billing",
    displayName: {
      fr: "Paiement d'abonnement échoué",
      en: "Subscription payment failed",
      wo: "Paiement abonnement jappul",
    },
    description: {
      fr: "Alerte le contact de facturation quand le renouvellement automatique échoue.",
      en: "Alerts the billing contact when auto-renewal fails.",
      wo: "Yónni ci kiy faye yoon wi bu renouvellement automatique jappul.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "SubscriptionPastDue" },
    triggerDomainEvent: "subscription.past_due",
    recipientResolver: "org-billing",
    scope: "organization",
  },

  // ─── Phase 2 P1 — reuses existing domain events ────────────────────────
  {
    key: "waitlist.promoted",
    category: "transactional",
    displayName: {
      fr: "Place disponible (liste d'attente)",
      en: "Spot available (waitlist)",
      wo: "Palaas amna (liste d'attente)",
    },
    description: {
      fr: "Notifie un participant que sa place sur liste d'attente est devenue disponible.",
      en: "Notifies a waitlisted participant that a spot has opened up.",
      wo: "Yeboo ci kiy ñëw ci liste d'attente bi.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "WaitlistPromoted" },
    triggerDomainEvent: "waitlist.promoted",
    recipientResolver: "self",
    scope: "event",
  },
  {
    key: "refund.issued",
    category: "billing",
    displayName: {
      fr: "Remboursement effectué",
      en: "Refund issued",
      wo: "Remboursement bi, defnan",
    },
    description: {
      fr: "Confirme qu'un remboursement a bien été initié.",
      en: "Confirms a refund has been initiated.",
      wo: "Dëggal ne remboursement bi, tàmbalee na.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "RefundIssued" },
    triggerDomainEvent: "payment.refunded",
    recipientResolver: "self",
    scope: "event",
  },
  {
    key: "refund.failed",
    category: "billing",
    displayName: {
      fr: "Remboursement échoué",
      en: "Refund failed",
      wo: "Remboursement jappul",
    },
    description: {
      fr: "Alerte le client et le support quand un remboursement échoue.",
      en: "Alerts the customer and support when a refund fails.",
      wo: "Yónni ci client bi ak support bu remboursement jappul.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "RefundFailed" },
    triggerDomainEvent: "payment.refunded",
    recipientResolver: "self",
    scope: "event",
  },
  {
    key: "member.added",
    category: "organizational",
    displayName: {
      fr: "Ajouté à une organisation",
      en: "Added to an organization",
      wo: "Yokku ci organisation",
    },
    description: {
      fr: "Envoyé à un membre ajouté à une organisation.",
      en: "Sent to a member added to an organization.",
      wo: "Yeboo ci kiy yokku ci organisation bi.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: true,
    templates: { email: "MemberUpdate" },
    triggerDomainEvent: "member.added",
    recipientResolver: "custom",
    scope: "organization",
  },
  {
    key: "member.removed",
    category: "organizational",
    displayName: {
      fr: "Retiré d'une organisation",
      en: "Removed from an organization",
      wo: "Summil ci organisation",
    },
    description: {
      fr: "Envoyé à un ancien membre retiré d'une organisation.",
      en: "Sent to a former member removed from an organization.",
      wo: "Yeboo ci kiy nañu summil ci organisation bi.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: true,
    templates: { email: "MemberUpdate" },
    triggerDomainEvent: "member.removed",
    recipientResolver: "custom",
    scope: "organization",
  },
  {
    key: "member.role_changed",
    category: "organizational",
    displayName: {
      fr: "Rôle mis à jour",
      en: "Role updated",
      wo: "Koppar soppi na",
    },
    description: {
      fr: "Envoyé quand un membre voit son rôle changer dans une organisation.",
      en: "Sent when a member's role is updated in an organization.",
      wo: "Yeboo bu koppar kiy organisation bi soppi.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: true,
    templates: { email: "MemberUpdate" },
    triggerDomainEvent: "member.role_changed",
    recipientResolver: "custom",
    scope: "organization",
  },
  {
    key: "speaker.added",
    category: "organizational",
    displayName: {
      fr: "Invité en tant qu'intervenant",
      en: "Added as a speaker",
      wo: "Yokku nga ni intervenant",
    },
    description: {
      fr: "Envoyé quand un intervenant est ajouté à un événement.",
      en: "Sent when a speaker is added to an event.",
      wo: "Yeboo bu intervenant bi yokku ci événement.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: true,
    templates: { email: "SpeakerAdded" },
    triggerDomainEvent: "speaker.added",
    recipientResolver: "custom",
    scope: "event",
  },
  {
    key: "sponsor.added",
    category: "organizational",
    displayName: {
      fr: "Enregistré en tant que sponsor",
      en: "Added as a sponsor",
      wo: "Yokku ni sponsor",
    },
    description: {
      fr: "Envoyé quand un sponsor est ajouté à un événement.",
      en: "Sent when a sponsor is added to an event.",
      wo: "Yeboo bu sponsor bi yokku ci événement.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: true,
    templates: { email: "SponsorAdded" },
    triggerDomainEvent: "sponsor.added",
    recipientResolver: "custom",
    scope: "event",
  },
  {
    key: "subscription.upgraded",
    category: "billing",
    displayName: {
      fr: "Abonnement mis à niveau",
      en: "Subscription upgraded",
      wo: "Abonnement bi, yokk nañ ko",
    },
    description: {
      fr: "Confirme le passage à un plan supérieur.",
      en: "Confirms the upgrade to a higher-tier plan.",
      wo: "Dëggal ne plan bi, yokk nañ ko.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "SubscriptionChange" },
    triggerDomainEvent: "subscription.upgraded",
    recipientResolver: "org-billing",
    scope: "organization",
  },
  {
    key: "subscription.downgraded",
    category: "billing",
    displayName: {
      fr: "Abonnement rétrogradé",
      en: "Subscription downgraded",
      wo: "Abonnement bi, wàññi nañ ko",
    },
    description: {
      fr: "Confirme le passage à un plan inférieur.",
      en: "Confirms the downgrade to a lower-tier plan.",
      wo: "Dëggal ne plan bi, wàññi nañ ko.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "SubscriptionChange" },
    triggerDomainEvent: "subscription.downgraded",
    recipientResolver: "org-billing",
    scope: "organization",
  },
  {
    key: "subscription.cancelled",
    category: "billing",
    displayName: {
      fr: "Abonnement annulé",
      en: "Subscription cancelled",
      wo: "Abonnement bi, neenal nañ ko",
    },
    description: {
      fr: "Confirme l'annulation d'un abonnement payant.",
      en: "Confirms the cancellation of a paid subscription.",
      wo: "Dëggal ne abonnement bi neenal nañ ko.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "SubscriptionChange" },
    triggerDomainEvent: "subscription.cancelled",
    recipientResolver: "org-billing",
    scope: "organization",
  },
  {
    key: "payout.created",
    category: "billing",
    displayName: {
      fr: "Virement programmé",
      en: "Payout scheduled",
      wo: "Transfert bi, programme nañ ko",
    },
    description: {
      fr: "Notifie l'organisateur qu'un virement est programmé vers son compte.",
      en: "Notifies the organiser that a payout has been scheduled.",
      wo: "Yeboo ci kiy organise ne transfert bi program nañ ko.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "PayoutCreated" },
    triggerDomainEvent: "payout.created",
    recipientResolver: "org-billing",
    scope: "organization",
  },
  {
    key: "welcome",
    category: "marketing",
    displayName: {
      fr: "Bienvenue sur Teranga",
      en: "Welcome to Teranga",
      wo: "Dalal ak diam ci Teranga",
    },
    description: {
      fr: "Email de bienvenue après la première inscription.",
      en: "Welcome email after the first sign-up.",
      wo: "Imayil dalal ginnaaw inscription bi.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: true,
    templates: { email: "Welcome" },
    triggerDomainEvent: "user.created",
    recipientResolver: "self",
    scope: "platform",
  },
  {
    key: "user.password_changed",
    category: "auth",
    displayName: {
      fr: "Mot de passe modifié",
      en: "Password changed",
      wo: "Mot de passe bi soppi na",
    },
    description: {
      fr: "Alerte de sécurité envoyée après un changement de mot de passe.",
      en: "Security alert sent after a password change.",
      wo: "Yeboo ci sécurité bu mot de passe bi soppeeku.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "PasswordChanged" },
    triggerDomainEvent: "user.password_changed",
    recipientResolver: "self",
    scope: "platform",
  },
  {
    key: "user.email_changed",
    category: "auth",
    displayName: {
      fr: "Adresse e-mail modifiée",
      en: "Email address changed",
      wo: "Adress imayil bi soppi na",
    },
    description: {
      fr: "Alerte de sécurité envoyée à l'ANCIENNE adresse lors d'un changement d'e-mail.",
      en: "Security alert sent to the OLD address when the email changes.",
      wo: "Yeboo ci ancien adress bi bu imayil bi soppi.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "EmailChanged" },
    triggerDomainEvent: "user.email_changed",
    recipientResolver: "custom",
    scope: "platform",
  },

  // ─── Phase 2.3 — post-event + lifecycle nudges ─────────────────────────
  // Scheduled / triggered lifecycle emails that close the feedback loop
  // after an event ends, surface certificates, and nudge organizers when
  // their subscription is about to expire or hitting its usage caps.
  // Scheduled emitters live in apps/functions/src/triggers/ (post-event,
  // certificate, subscription-reminder) and route through the API's
  // internal dispatch endpoint.
  {
    key: "event.feedback_requested",
    category: "transactional",
    displayName: {
      fr: "Demande de retour sur l'événement",
      en: "Post-event feedback request",
      wo: "Ñaan ñu joxe seen xalaat ci événement bi",
    },
    description: {
      fr: "Envoyé 2 heures après la fin d'un événement aux participants présents.",
      en: "Sent 2 hours after an event ends to every attendee who showed up.",
      wo: "Yeboo 2 waxtu ginnaaw événement bi, ci ñépp ñu ko wone.",
    },
    supportedChannels: ["email", "in_app"],
    defaultChannels: ["email", "in_app"],
    userOptOutAllowed: true,
    templates: { email: "EventFeedbackRequested", in_app: "EventFeedbackRequested" },
    triggerDomainEvent: "event.feedback_requested",
    recipientResolver: "custom",
    scope: "event",
  },
  {
    key: "certificate.ready",
    category: "organizational",
    displayName: {
      fr: "Certificat de participation disponible",
      en: "Certificate of attendance ready",
      wo: "Certificat participation bi wóor na",
    },
    description: {
      fr: "Informe le participant que son certificat de participation est prêt à télécharger.",
      en: "Tells the participant their certificate of attendance is ready to download.",
      wo: "Yeboo ci kiy bokk ne sa certificat wóor na ngir download.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: true,
    templates: { email: "CertificateReady" },
    triggerDomainEvent: "event.certificates_issued",
    recipientResolver: "custom",
    scope: "event",
  },
  {
    key: "subscription.expiring_soon",
    category: "billing",
    displayName: {
      fr: "Abonnement arrivant à expiration",
      en: "Subscription expiring soon",
      wo: "Abonnement bi, damay jeex",
    },
    description: {
      fr: "Alerte le contact de facturation 7 jours avant le renouvellement d'un abonnement payant.",
      en: "Alerts the billing contact 7 days before a paid subscription renews.",
      wo: "Yeboo ci kiy faye yoon wi 7 fan laata renouvellement bi.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: false,
    templates: { email: "SubscriptionExpiringSoon" },
    triggerDomainEvent: "subscription.expiring_soon",
    recipientResolver: "org-billing",
    scope: "organization",
  },
  {
    key: "subscription.approaching_limit",
    category: "organizational",
    displayName: {
      fr: "Limite du plan bientôt atteinte",
      en: "Plan limit approaching",
      wo: "Limite plan bi jegesi na",
    },
    description: {
      fr: "Prévient les propriétaires de l'organisation quand une limite du plan dépasse 80%.",
      en: "Warns organization owners when any plan limit exceeds 80% usage.",
      wo: "Yeboo ci ñi yor organisation bi bu benn limite ci plan bi weesu 80%.",
    },
    supportedChannels: ["email"],
    defaultChannels: ["email"],
    userOptOutAllowed: true,
    templates: { email: "SubscriptionApproachingLimit" },
    triggerDomainEvent: "subscription.approaching_limit",
    recipientResolver: "org-owners",
    scope: "organization",
  },
] as const;

/**
 * Index every entry by key for O(1) dispatcher lookup. Frozen so consumers
 * cannot mutate the catalog at runtime.
 */
export const NOTIFICATION_CATALOG_BY_KEY: Readonly<Record<string, NotificationDefinition>> =
  Object.freeze(Object.fromEntries(NOTIFICATION_CATALOG.map((def) => [def.key, def])));

/** Type-safe set of all catalog keys. */
export type NotificationKey = (typeof NOTIFICATION_CATALOG)[number]["key"];

/**
 * Runtime guard — useful on the admin API boundary when accepting a key
 * from a request body. Narrows the string to a known catalog key.
 */
export function isKnownNotificationKey(value: string): boolean {
  return value in NOTIFICATION_CATALOG_BY_KEY;
}

/**
 * Catalog invariants check. Called once at module load time so
 * misconfigurations fail fast at server boot, not on the first send.
 * Exported for the unit test suite.
 */
export function assertCatalogIntegrity(
  catalog: readonly NotificationDefinition[] = NOTIFICATION_CATALOG,
): void {
  const seen = new Set<string>();
  for (const def of catalog) {
    if (seen.has(def.key)) {
      throw new Error(`Duplicate notification key in catalog: ${def.key}`);
    }
    seen.add(def.key);

    // defaultChannels must be a subset of supportedChannels.
    for (const ch of def.defaultChannels) {
      if (!def.supportedChannels.includes(ch)) {
        throw new Error(`Catalog "${def.key}": default channel "${ch}" not in supportedChannels`);
      }
    }

    // Every supportedChannel must have a template id.
    for (const ch of def.supportedChannels) {
      if (!def.templates[ch]) {
        throw new Error(
          `Catalog "${def.key}": supportedChannel "${ch}" missing templates["${ch}"]`,
        );
      }
    }

    // Mandatory categories must not allow user opt-out.
    if ((def.category === "auth" || def.category === "billing") && def.userOptOutAllowed) {
      throw new Error(
        `Catalog "${def.key}": category "${def.category}" must have userOptOutAllowed=false`,
      );
    }
  }
}

// Fail-fast at import. The invariants are cheap and a misconfigured
// catalog in prod would silently drop sends — better to never boot.
assertCatalogIntegrity();

// ─── Channel Adapter Contract (Phase 2.6) ──────────────────────────────────
// Forward-looking, cross-channel adapter contract. Today only email is wired
// through `EmailChannelAdapter` (see apps/api/src/services/
// notification-dispatcher.service.ts). As SMS / push / in_app land in
// Phase 6+, each provider ships a `ChannelAdapter` matching the shape below
// and registers it with the channel registry
// (apps/api/src/services/notifications/channel-registry.ts). The dispatcher
// is not yet wired to the forward-looking registry — integration is Phase 3.

/**
 * Machine-readable capability profile each adapter advertises so the
 * dispatcher / admin UI can reason about template fit without calling the
 * provider. e.g. SMS adapters expose `maxBodyLength: 160`, email adapters
 * expose `attachments: true`.
 */
export const ChannelCapabilitiesSchema = z.object({
  /** True when the channel honours file attachments (today: email only). */
  attachments: z.boolean(),
  /** True when the channel renders HTML / rich markup (email + in_app). */
  richText: z.boolean(),
  /** Max body length in chars. 0 = unlimited. */
  maxBodyLength: z.number().int().nonnegative(),
  /** Locales the provider supports. Empty = every catalog locale. */
  supportedLocales: z.array(NotificationLocaleSchema),
});

export type ChannelCapabilities = z.infer<typeof ChannelCapabilitiesSchema>;

/**
 * Cross-channel dispatch params — the dispatcher hands these to every
 * channel adapter. Email today, SMS / push / in_app as adapters are
 * wired in Phase 6+. The shape is intentionally generic: template
 * resolution (react-email, SMS string builder, push payload builder)
 * is the adapter's responsibility.
 */
export interface ChannelDispatchParams<
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  definition: NotificationDefinition;
  recipient: NotificationRecipient;
  templateParams: P;
  idempotencyKey: string;
  /** Populated when the admin issued a "test send" from the control plane. */
  testMode?: boolean;
}

export interface ChannelDispatchResult {
  ok: boolean;
  /** Provider-returned id (Resend message id, Twilio sid, FCM message name). */
  providerMessageId?: string;
  /** Machine-readable suppression reason when ok=false. */
  suppressed?: NotificationSuppressionReason;
  /** Cost in XOF *1000 micro-units (integer). Optional — only SMS tracks this today. */
  costXofMicro?: number;
}

/**
 * Every channel implementation registers an adapter matching this contract.
 * Contract rules (enforced in code review, not yet by types):
 *   - send() never throws; failures bubble via ok=false + suppressed.
 *   - supports() is a fast synchronous check (used by the dispatcher to
 *     skip a channel without touching Firestore).
 *   - capabilities describes what templating features the channel honours
 *     (attachments: email only; richText: email+in_app; shortBody: sms).
 */
export interface ChannelAdapter<
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly channel: NotificationChannel;
  readonly capabilities: ChannelCapabilities;
  supports(definition: NotificationDefinition): boolean;
  send(params: ChannelDispatchParams<P>): Promise<ChannelDispatchResult>;
}
