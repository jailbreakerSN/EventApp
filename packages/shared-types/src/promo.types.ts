import { z } from "zod";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const DiscountTypeSchema = z.enum(["percentage", "fixed"]);
export type DiscountType = z.infer<typeof DiscountTypeSchema>;

// ─── Promo Code ──────────────────────────────────────────────────────────────

export const PromoCodeSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  organizationId: z.string(),
  code: z.string().min(2).max(50).transform((v) => v.toUpperCase()),
  discountType: DiscountTypeSchema,
  discountValue: z.number().positive(),
  maxUses: z.number().int().positive().nullable().default(null),
  usedCount: z.number().int().nonnegative().default(0),
  expiresAt: z.string().datetime().nullable().default(null),
  ticketTypeIds: z.array(z.string()).default([]), // empty = applies to all ticket types
  isActive: z.boolean().default(true),
  createdBy: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PromoCode = z.infer<typeof PromoCodeSchema>;

// ─── Create Promo Code DTO ──────────────────────────────────────────────────

export const CreatePromoCodeSchema = z.object({
  eventId: z.string(),
  code: z.string().min(2).max(50).transform((v) => v.toUpperCase()),
  discountType: DiscountTypeSchema,
  discountValue: z.number().positive(),
  maxUses: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  ticketTypeIds: z.array(z.string()).optional(),
});

export type CreatePromoCodeDto = z.infer<typeof CreatePromoCodeSchema>;

// ─── Validate Promo Code ────────────────────────────────────────────────────

export const ValidatePromoCodeSchema = z.object({
  code: z.string().min(1).transform((v) => v.toUpperCase()),
  eventId: z.string(),
  ticketTypeId: z.string(),
});

export type ValidatePromoCodeDto = z.infer<typeof ValidatePromoCodeSchema>;

// ─── Promo Code Query ───────────────────────────────────────────────────────

export const PromoCodeQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type PromoCodeQuery = z.infer<typeof PromoCodeQuerySchema>;
