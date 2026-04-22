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
  enabled: z.boolean(),
  channels: z.array(NotificationChannelSchema),
  subjectOverride: I18nStringSchema.optional(),
  updatedAt: z.string().datetime(),
  updatedBy: z.string().min(1),
});

export type NotificationSetting = z.infer<typeof NotificationSettingSchema>;

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
