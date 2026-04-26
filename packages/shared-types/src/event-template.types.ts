/**
 * Organizer overhaul — Phase O10.
 *
 * Event starter-template catalog. The 8 templates live as data in
 * shared-types so the backoffice picker, the API service, and the
 * mobile app (eventually) read from one source. Each template
 * declares the same structural shape (category + duration + tickets +
 * sessions + comms timeline) so the API's `cloneFromTemplate()` can
 * produce a new event with sensible defaults in one call.
 *
 * What a template is NOT: an event itself. The template doesn't have
 * dates — the operator picks `startDate` at clone-time and the
 * service materialises absolute timestamps from the template's
 * relative offsets (`offsetDays`, `offsetMinutes`).
 */

import { z } from "zod";
import { EventCategorySchema } from "./event.types";

// ─── Template ticket type (relative price + relative dates) ──────────────

export const TemplateTicketTypeSchema = z.object({
  /** Stable id within the template (used for accessZone references). */
  id: z.string(),
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  price: z.number().int().min(0).default(0),
  /** Capacity — null = unlimited. */
  totalQuantity: z.number().int().positive().nullable().default(null),
  /** Relative offset in days from `startDate`; sales open `offsetDays` days before. */
  saleOpensOffsetDays: z.number().int().nullable().default(null),
});
export type TemplateTicketType = z.infer<typeof TemplateTicketTypeSchema>;

// ─── Template session (relative to event start) ──────────────────────────

export const TemplateSessionSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  /** Offset in minutes from `event.startDate`. */
  offsetMinutes: z.number().int().min(0),
  durationMinutes: z.number().int().positive(),
  location: z.string().max(120).optional(),
});
export type TemplateSession = z.infer<typeof TemplateSessionSchema>;

// ─── Template comms timeline ─────────────────────────────────────────────
//
// One row per planned broadcast. Offsets are relative to `event.startDate`:
// negative = "before start", positive = "after start".

export const TemplateCommsBlueprintSchema = z.object({
  /** Stable id within the template, used as broadcast title fallback. */
  id: z.string(),
  /** Days from start; -7 = 7 days before, +1 = 1 day after. */
  offsetDays: z.number().int(),
  /** Default channels — operator can edit at create-time. */
  channels: z.array(z.enum(["email", "sms", "push", "whatsapp", "in_app"])).min(1),
  /** FR title placeholder. */
  title: z.string().max(120),
  /** FR body placeholder. */
  body: z.string().max(500),
});
export type TemplateCommsBlueprint = z.infer<typeof TemplateCommsBlueprintSchema>;

// ─── Top-level template ──────────────────────────────────────────────────

export const EventTemplateSchema = z.object({
  /** Stable id — referenced in URLs (`?template=workshop`) + analytics. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  category: EventCategorySchema,
  /** FR display name in the picker. */
  label: z.string().min(2).max(80),
  /** FR short description (≤ 200 chars) — surfaced in the picker. */
  tagline: z.string().max(200),
  /** FR long description for the detail card. */
  description: z.string().max(800),
  /** Lucide icon name — picked from a static allowlist in the UI. */
  icon: z.enum([
    "GraduationCap",
    "Mic",
    "PartyPopper",
    "Code",
    "Building",
    "BookOpen",
    "HeartHandshake",
    "Sparkles",
  ]),
  /** Default duration in hours used to derive `endDate = startDate + h`. */
  defaultDurationHours: z.number().int().positive().max(720),
  ticketTypes: z.array(TemplateTicketTypeSchema).default([]),
  sessions: z.array(TemplateSessionSchema).default([]),
  commsBlueprint: z.array(TemplateCommsBlueprintSchema).default([]),
  /** Free-text tags pre-applied (e.g. "tech", "professionnel"). */
  tags: z.array(z.string().max(40)).default([]),
});
export type EventTemplate = z.infer<typeof EventTemplateSchema>;

// ─── Clone DTO (operator picks startDate + title) ────────────────────────

export const CloneFromTemplateSchema = z.object({
  templateId: z.string().regex(/^[a-z0-9-]+$/),
  /** Override the template label — usually the real event name. */
  title: z.string().min(3).max(200),
  startDate: z.string().datetime(),
  /** Optional override; defaults to start + template.defaultDurationHours. */
  endDate: z.string().datetime().optional(),
  /** Operator's organization (the event will be scoped to it). */
  organizationId: z.string(),
  /** Optional override of the venue (defaults to "in person — TBD"). */
  venueName: z.string().max(200).optional(),
});
export type CloneFromTemplateDto = z.infer<typeof CloneFromTemplateSchema>;

// ─── Helpers exported for tests + UI ─────────────────────────────────────

/**
 * Compute the clone's `endDate` from the template duration unless an
 * explicit override was provided. Pure — no Date in/out.
 */
export function resolveTemplateEndDate(
  template: Pick<EventTemplate, "defaultDurationHours">,
  startIso: string,
  override?: string,
): string {
  if (override) return override;
  const startMs = new Date(startIso).getTime();
  return new Date(startMs + template.defaultDurationHours * 60 * 60 * 1000).toISOString();
}
