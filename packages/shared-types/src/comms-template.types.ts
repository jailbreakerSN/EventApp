/**
 * Organizer overhaul — Phase O5.
 *
 * Communications template library — pre-written FR copy for the
 * recurring messages every event organizer ends up rewriting from
 * scratch (J-7 reminder, J-1 reminder, payment confirmation, waitlist
 * promotion notice, post-event feedback prompt …).
 *
 * Design choices:
 *  - Templates are STATIC TypeScript constants (not Firestore documents)
 *    in the first iteration. Reasons:
 *      • The 12 starter templates ship with the product — they are
 *        not user data, they are Teranga's editorial content.
 *      • A future iteration can layer organisation-scoped CUSTOM
 *        templates on top via a Firestore collection without
 *        invalidating the static seed.
 *  - `body` supports a tiny mustache-style variable syntax: `{{event}}`,
 *    `{{date}}`, `{{participant}}`. The composer substitutes these at
 *    render time using the active event + recipient context. We keep
 *    the variable set narrow on purpose — the more variables a
 *    template carries, the more brittle it becomes when copied across
 *    locales / channels / use-cases.
 *  - Each template carries the suggested `defaultChannels` so the
 *    composer can pre-select the right delivery surface (e.g. the
 *    payment-confirmation template pre-selects email, the J-1 reminder
 *    pre-selects push + SMS).
 *  - `category` groups templates so the UI can offer a tabbed library
 *    (Reminders / Confirmations / Lifecycle / Re-engagement).
 */

import { z } from "zod";
import { CommunicationChannelSchema } from "./communication.types";

export const CommsTemplateCategorySchema = z.enum([
  "reminder",
  "confirmation",
  "lifecycle",
  "reengagement",
]);
export type CommsTemplateCategory = z.infer<typeof CommsTemplateCategorySchema>;

export const CommsTemplateSchema = z.object({
  id: z.string(),
  category: CommsTemplateCategorySchema,
  /** Short FR label shown in the picker. */
  label: z.string().min(1).max(120),
  /** One-line FR description of the use-case. */
  description: z.string().min(1).max(240),
  /** FR title (used as the broadcast `title`). Supports `{{event}}` interpolation. */
  title: z.string().min(1).max(200),
  /** FR body (used as the broadcast `body`). Supports `{{event}}` / `{{date}}` interpolation. */
  body: z.string().min(1).max(2000),
  /** Channels the composer should pre-select when this template is picked. */
  defaultChannels: z.array(CommunicationChannelSchema).min(1),
  /** Optional hint shown next to the template card (e.g. "À envoyer J-7"). */
  timing: z.string().max(80).optional(),
});
export type CommsTemplate = z.infer<typeof CommsTemplateSchema>;

/**
 * The 12 starter templates that ship with Teranga. Order in the
 * array = display order in the library UI.
 *
 * Editorial guidance:
 *  - Tone is direct + warm. Senegalese francophone register: vouvoiement,
 *    short sentences, no English idioms, no exclamation overload.
 *  - Variables are wrapped in `{{...}}` and resolved by the composer
 *    using the active event title + start date + the participant's
 *    first name when available.
 *  - Length is tuned so the message reads cleanly on a push notification
 *    (title ≤ 60 chars, body ≤ 280 chars where possible) AND on email
 *    (the body lines wrap naturally).
 */
export const SEED_COMMS_TEMPLATES: readonly CommsTemplate[] = [
  // ─── Reminders ──────────────────────────────────────────────────────────
  {
    id: "reminder-j7",
    category: "reminder",
    label: "Rappel J-7",
    description: "Rappel envoyé une semaine avant l'événement.",
    title: "Rendez-vous dans une semaine — {{event}}",
    body: "Bonjour {{participant}}, c'est dans une semaine ! {{event}} se tient le {{date}}. Pensez à préparer votre badge dans l'application Teranga avant votre arrivée. À très bientôt.",
    defaultChannels: ["email", "push"],
    timing: "À envoyer J-7",
  },
  {
    id: "reminder-j1",
    category: "reminder",
    label: "Rappel J-1",
    description: "Dernier rappel la veille de l'événement.",
    title: "C'est demain ! — {{event}}",
    body: "Bonjour {{participant}}, rendez-vous demain pour {{event}}. Ouvrez votre badge dans l'application Teranga avant votre arrivée pour gagner du temps au check-in. Bonne préparation.",
    defaultChannels: ["push", "sms"],
    timing: "À envoyer J-1",
  },
  {
    id: "reminder-doors-open",
    category: "reminder",
    label: "Ouverture des portes",
    description: "Notification le jour J, à l'ouverture des portes.",
    title: "Les portes sont ouvertes — {{event}}",
    body: "Bienvenue ! L'accueil pour {{event}} est ouvert. Préparez votre badge à scanner et présentez-vous à l'entrée. L'équipe sur place vous oriente.",
    defaultChannels: ["push"],
    timing: "À envoyer J-0 à H-0",
  },

  // ─── Confirmations ──────────────────────────────────────────────────────
  {
    id: "confirmation-registration",
    category: "confirmation",
    label: "Confirmation d'inscription",
    description: "Envoyé automatiquement après l'inscription.",
    title: "Votre inscription à {{event}} est confirmée",
    body: "Bonjour {{participant}}, votre inscription à {{event}} (le {{date}}) est confirmée. Vous recevrez un rappel quelques jours avant. À très bientôt.",
    defaultChannels: ["email"],
    timing: "Auto à l'inscription",
  },
  {
    id: "confirmation-payment",
    category: "confirmation",
    label: "Confirmation de paiement",
    description: "Envoyé après un paiement réussi.",
    title: "Paiement confirmé — {{event}}",
    body: "Bonjour {{participant}}, nous confirmons la réception de votre paiement pour {{event}}. Votre reçu est disponible dans votre espace personnel. Merci de votre confiance.",
    defaultChannels: ["email"],
    timing: "Auto au paiement",
  },
  {
    id: "confirmation-waitlist-promoted",
    category: "confirmation",
    label: "Promotion depuis la liste d'attente",
    description: "Envoyé quand une place se libère pour un participant en attente.",
    title: "Bonne nouvelle : votre place est confirmée — {{event}}",
    body: "Bonjour {{participant}}, une place s'est libérée pour {{event}} et nous vous l'avons attribuée. Votre badge est disponible dans l'application. Au plaisir de vous y retrouver.",
    defaultChannels: ["email", "push"],
    timing: "Auto à la promotion",
  },

  // ─── Lifecycle ──────────────────────────────────────────────────────────
  {
    id: "lifecycle-event-published",
    category: "lifecycle",
    label: "Annonce de publication",
    description: "Pour annoncer la publication d'un nouvel événement à votre audience.",
    title: "Nouveau : {{event}} — inscriptions ouvertes",
    body: "Nous avons le plaisir de vous annoncer {{event}}, le {{date}}. Les inscriptions sont ouvertes. Réservez votre place dès maintenant — les meilleures catégories partent vite.",
    defaultChannels: ["email"],
    timing: "À envoyer à la publication",
  },
  {
    id: "lifecycle-schedule-change",
    category: "lifecycle",
    label: "Changement de programme",
    description: "Notification d'un changement d'horaire ou de session.",
    title: "Changement de programme — {{event}}",
    body: "Bonjour {{participant}}, le programme de {{event}} a évolué. Consultez la nouvelle version dans votre application Teranga. Si vous ne pouvez plus assister, merci de nous prévenir.",
    defaultChannels: ["email", "push"],
    timing: "Au moment du changement",
  },
  {
    id: "lifecycle-venue-update",
    category: "lifecycle",
    label: "Mise à jour du lieu",
    description: "Confirmation du lieu, plan d'accès, parking.",
    title: "Lieu et accès — {{event}}",
    body: "Bonjour {{participant}}, voici les informations pratiques pour {{event}} : adresse, accès en transports, parking. Tout est dans votre badge dans l'application.",
    defaultChannels: ["email"],
    timing: "À envoyer J-3",
  },

  // ─── Re-engagement ──────────────────────────────────────────────────────
  {
    id: "reengagement-feedback",
    category: "reengagement",
    label: "Demande de feedback",
    description: "Sondage post-événement, envoyé J+1.",
    title: "Merci d'avoir participé à {{event}} — votre avis compte",
    body: "Bonjour {{participant}}, merci d'avoir participé à {{event}}. Pourriez-vous nous accorder 2 minutes pour partager votre ressenti ? Votre retour nous aide à organiser de meilleurs événements.",
    defaultChannels: ["email"],
    timing: "À envoyer J+1",
  },
  {
    id: "reengagement-no-show",
    category: "reengagement",
    label: "Relance des absents",
    description: "Pour les inscrits qui ne se sont pas présentés (no-show).",
    title: "Nous ne vous avons pas vu — {{event}}",
    body: "Bonjour {{participant}}, vous étiez attendu à {{event}} et nous ne vous avons pas vu. Tout va bien ? Si un imprévu vous a empêché de venir, faites-le nous savoir — votre place est précieuse.",
    defaultChannels: ["email"],
    timing: "À envoyer J+1 (no-show)",
  },
  {
    id: "reengagement-next-event",
    category: "reengagement",
    label: "Annonce de l'événement suivant",
    description: "Pour fidéliser une cohorte présente lors d'un événement.",
    title: "Et la suite ? Découvrez notre prochain événement",
    body: "Bonjour {{participant}}, merci encore d'être venu à {{event}}. Notre prochain rendez-vous arrive bientôt — soyez les premiers informés en gardant l'œil sur votre boîte mail.",
    defaultChannels: ["email"],
    timing: "À envoyer J+7",
  },
];

/**
 * Resolve `{{event}}`, `{{date}}`, `{{participant}}` placeholders in
 * a template field. Pure helper — exported so the composer can render
 * a live preview as the organizer types and so unit tests can pin the
 * substitution behaviour.
 *
 * Unknown placeholders are left in place (visible to the operator
 * during composition), which is the safer default than silent
 * stripping.
 */
export function renderCommsTemplate(
  text: string,
  vars: { event?: string; date?: string; participant?: string },
): string {
  return text
    .replace(/\{\{event\}\}/g, vars.event ?? "{{event}}")
    .replace(/\{\{date\}\}/g, vars.date ?? "{{date}}")
    .replace(/\{\{participant\}\}/g, vars.participant ?? "{{participant}}");
}
