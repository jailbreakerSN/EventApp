import { z } from "zod";

/**
 * Senegalese phone number validation.
 *
 * Valid formats:
 * - +221 7X XXX XX XX (international with spaces)
 * - +2217XXXXXXXX (international no spaces)
 * - 7X XXX XX XX (local with spaces)
 * - 7XXXXXXXX (local no spaces)
 *
 * Senegalese mobile numbers:
 * - 70/76/77/78: Orange
 * - 75: Free/Tigo
 * - 76/77/78: multiple operators
 */

const SENEGAL_PHONE_REGEX = /^\+?221?\s?[7][0-8]\s?\d{3}\s?\d{2}\s?\d{2}$/;

/**
 * Normalize a Senegalese phone number to E.164 format: +221XXXXXXXXX
 * Returns null if the number is invalid.
 */
export function normalizeSenegalPhone(phone: string): string | null {
  // Strip all whitespace, dashes, dots, parentheses
  const cleaned = phone.replace(/[\s\-().]/g, "");

  let digits: string;

  if (cleaned.startsWith("+221")) {
    digits = cleaned.slice(4);
  } else if (cleaned.startsWith("00221")) {
    digits = cleaned.slice(5);
  } else if (cleaned.startsWith("221") && cleaned.length === 12) {
    digits = cleaned.slice(3);
  } else if (cleaned.startsWith("7") && cleaned.length === 9) {
    digits = cleaned;
  } else {
    return null;
  }

  // Must be 9 digits starting with 7[0-8]
  if (!/^7[0-8]\d{7}$/.test(digits)) {
    return null;
  }

  return `+221${digits}`;
}

/**
 * Validate that a string is a valid Senegalese phone number.
 */
export function isValidSenegalPhone(phone: string): boolean {
  return normalizeSenegalPhone(phone) !== null;
}

/**
 * Zod schema for Senegalese phone numbers.
 * Accepts various formats, normalizes to +221XXXXXXXXX.
 */
export const SenegalPhoneSchema = z
  .string()
  .min(9, "Numéro de téléphone trop court")
  .max(17, "Numéro de téléphone trop long")
  .refine(isValidSenegalPhone, {
    message: "Numéro de téléphone sénégalais invalide (format: +221 7X XXX XX XX)",
  })
  .transform((val) => normalizeSenegalPhone(val)!);

/**
 * Optional phone schema — validates only if provided.
 */
export const OptionalSenegalPhoneSchema = z
  .string()
  .optional()
  .nullable()
  .transform((val) => {
    if (!val) return null;
    return normalizeSenegalPhone(val);
  });
