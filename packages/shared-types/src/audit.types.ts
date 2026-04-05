import { z } from "zod";

// ─── Audit Log Entry ─────────────────────────────────────────────────────────
// Structured audit record for security-sensitive operations.
// Written by the API's domain event listeners; read by super admins.

export const AuditActionSchema = z.enum([
  "registration.created",
  "registration.cancelled",
  "registration.approved",
  "checkin.completed",
  "event.created",
  "event.updated",
  "event.published",
  "event.cancelled",
  "event.archived",
  "organization.created",
  "member.added",
  "member.removed",
  "badge.generated",
]);

export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditLogEntrySchema = z.object({
  id: z.string(),
  action: AuditActionSchema,
  actorId: z.string(),
  requestId: z.string(),
  timestamp: z.string().datetime(),
  resourceType: z.string(),
  resourceId: z.string(),
  eventId: z.string().nullable(),
  organizationId: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
});

export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

// ─── Registration Request Schemas ────────────────────────────────────────────
// Used for API route validation on registration endpoints.

export const CreateRegistrationSchema = z.object({
  eventId: z.string(),
  ticketTypeId: z.string(),
});

export type CreateRegistrationDto = z.infer<typeof CreateRegistrationSchema>;

export const CheckInSchema = z.object({
  qrCodeValue: z.string(),
  accessZoneId: z.string().optional(),
});

export type CheckInDto = z.infer<typeof CheckInSchema>;

export const ApproveRegistrationParamsSchema = z.object({
  registrationId: z.string(),
});
