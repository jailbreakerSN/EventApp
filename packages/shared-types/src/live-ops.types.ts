/**
 * Organizer overhaul — Phase O8.
 *
 * Live Event Mode types. Four concerns share this file:
 *
 *  1. **Incidents** — operator-logged signalements (medical, theft,
 *     latecomers, technical hiccup). Each one is a row with status
 *     and assignee for floor-ops triage.
 *  2. **Staff messages** — per-event internal chat ("staff radio")
 *     so the team coordinates in-band on the floor.
 *  3. **Emergency broadcasts** — instant multi-channel fan-out
 *     (push + sms + whatsapp) used for evacuation, schedule shifts,
 *     last-minute reroute. Strict audit (every send logged).
 *  4. **Live stats** — read-only aggregations powering the live
 *     dashboard (scan rate, queue, no-show estimate, staff online).
 *
 * Why a single types file: the four objects are bound by one
 * surface (the live page) and share lifetime (same event, same
 * J-0 window). Splitting would force four imports per consumer;
 * co-location keeps the dependency graph flat.
 */

import { z } from "zod";
import { CommunicationChannelSchema } from "./communication.types";

// ─── Incidents ────────────────────────────────────────────────────────────

export const IncidentSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type IncidentSeverity = z.infer<typeof IncidentSeveritySchema>;

export const IncidentKindSchema = z.enum([
  "medical", // health emergency
  "theft", // suspected theft / lost item
  "latecomer", // VIP late, ticket dispute, etc.
  "technical", // scanner down, wifi out
  "logistics", // queue overflow, parking, catering
  "security", // crowd issue, fight, threat
  "other",
]);
export type IncidentKind = z.infer<typeof IncidentKindSchema>;

export const IncidentStatusSchema = z.enum([
  "open", // freshly logged
  "triaged", // organiser assigned a member
  "in_progress", // member is on it
  "resolved",
]);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const IncidentSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  organizationId: z.string(),
  kind: IncidentKindSchema,
  severity: IncidentSeveritySchema,
  status: IncidentStatusSchema.default("open"),
  /** FR free-text description from the staff member who logged it. */
  description: z.string().min(1).max(2000),
  /** Optional location hint ("Hall A — entrée 3"). */
  location: z.string().max(200).nullable().optional(),
  /** uid of the staff who reported. */
  reportedBy: z.string(),
  /** uid of the organizer / staff currently assigned, or null. */
  assignedTo: z.string().nullable().optional(),
  /** Resolution note when status === "resolved". */
  resolutionNote: z.string().max(2000).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable().optional(),
});
export type Incident = z.infer<typeof IncidentSchema>;

export const CreateIncidentSchema = z.object({
  kind: IncidentKindSchema,
  severity: IncidentSeveritySchema,
  description: z.string().min(1).max(2000),
  location: z.string().max(200).optional(),
});
export type CreateIncidentDto = z.infer<typeof CreateIncidentSchema>;

export const UpdateIncidentSchema = z.object({
  status: IncidentStatusSchema.optional(),
  assignedTo: z.string().nullable().optional(),
  resolutionNote: z.string().max(2000).nullable().optional(),
});
export type UpdateIncidentDto = z.infer<typeof UpdateIncidentSchema>;

// ─── Staff messages (in-event radio chat) ────────────────────────────────

export const StaffMessageSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  organizationId: z.string(),
  /** uid of the sender. */
  authorId: z.string(),
  /** Denormalised display name so the UI doesn't N+1 user fetches. */
  authorName: z.string().max(120),
  body: z.string().min(1).max(1000),
  createdAt: z.string().datetime(),
});
export type StaffMessage = z.infer<typeof StaffMessageSchema>;

export const CreateStaffMessageSchema = z.object({
  body: z.string().min(1).max(1000),
});
export type CreateStaffMessageDto = z.infer<typeof CreateStaffMessageSchema>;

// ─── Emergency broadcasts ────────────────────────────────────────────────
//
// Distinct from regular `Broadcast` (Phase O5) because:
//   - Always fires NOW (no scheduledAt).
//   - Multi-channel hard-default (push + sms enforced; whatsapp added
//     when the org plan + per-recipient opt-in allow).
//   - Carries an `audited: true` flag so the consumer (audit listener)
//     keeps a forensic row even when the regular broadcast audit is
//     trimmed.

export const EmergencyBroadcastSchema = z.object({
  /** Short title (push notification headline). */
  title: z.string().min(1).max(120),
  /** Body — kept short to fit SMS / push body limits. */
  body: z.string().min(1).max(500),
  /** Channels to dispatch over. Defaults enforced server-side. */
  channels: z.array(CommunicationChannelSchema).min(1),
  /** Brief operator-supplied reason — required for audit. */
  reason: z.string().min(1).max(500),
});
export type EmergencyBroadcastDto = z.infer<typeof EmergencyBroadcastSchema>;

export interface EmergencyBroadcastResult {
  /** Number of recipients targeted (pre-deduplication). */
  recipientCount: number;
  /** Number of deliveries actually accepted by their channel. */
  dispatchedCount: number;
  /** Per-channel breakdown for the toast / audit. */
  perChannel: Record<string, number>;
}

// ─── Live stats (dashboard read model) ───────────────────────────────────

export const LiveStatsSchema = z.object({
  eventId: z.string(),
  /**
   * Number of badges scanned in the last 30 minutes, bucketed by
   * 1-minute slots. 30 entries, oldest → newest.
   */
  scanRate: z.array(
    z.object({
      /** ISO start of the bucket. */
      at: z.string().datetime(),
      count: z.number().int().min(0),
    }),
  ),
  /** registeredCount − checkedInCount, capped at 0. */
  queueEstimate: z.number().int().min(0),
  /**
   * Estimated no-shows: registered participants whose start window
   * has passed and who haven't been scanned. Updated lazily.
   */
  noShowEstimate: z.number().int().min(0),
  /** Number of staff users with an active session in the last 5 min. */
  staffOnline: z.number().int().min(0),
  /** Counts by incident status (open / triaged / in_progress). */
  incidentsByStatus: z.record(z.string(), z.number().int().min(0)),
  computedAt: z.string().datetime(),
});
export type LiveStats = z.infer<typeof LiveStatsSchema>;
