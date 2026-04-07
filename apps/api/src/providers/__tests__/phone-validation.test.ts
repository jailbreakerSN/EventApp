import { describe, it, expect } from "vitest";
import { normalizeSenegalPhone, isValidSenegalPhone, SenegalPhoneSchema } from "@teranga/shared-types";

describe("Senegal phone validation", () => {
  describe("normalizeSenegalPhone", () => {
    it("normalizes +221 format", () => {
      expect(normalizeSenegalPhone("+221771234567")).toBe("+221771234567");
    });

    it("normalizes with spaces", () => {
      expect(normalizeSenegalPhone("+221 77 123 45 67")).toBe("+221771234567");
    });

    it("normalizes local format", () => {
      expect(normalizeSenegalPhone("771234567")).toBe("+221771234567");
    });

    it("normalizes 221 prefix without +", () => {
      expect(normalizeSenegalPhone("221771234567")).toBe("+221771234567");
    });

    it("normalizes 00221 prefix", () => {
      expect(normalizeSenegalPhone("00221771234567")).toBe("+221771234567");
    });

    it("accepts Orange numbers (77, 78)", () => {
      expect(normalizeSenegalPhone("+221771234567")).toBe("+221771234567");
      expect(normalizeSenegalPhone("+221781234567")).toBe("+221781234567");
    });

    it("accepts Free/Tigo numbers (75, 76)", () => {
      expect(normalizeSenegalPhone("+221751234567")).toBe("+221751234567");
      expect(normalizeSenegalPhone("+221761234567")).toBe("+221761234567");
    });

    it("accepts Expresso numbers (70)", () => {
      expect(normalizeSenegalPhone("+221701234567")).toBe("+221701234567");
    });

    it("rejects invalid prefix (non-7)", () => {
      expect(normalizeSenegalPhone("+221611234567")).toBeNull();
    });

    it("rejects too short number", () => {
      expect(normalizeSenegalPhone("7712345")).toBeNull();
    });

    it("rejects too long number", () => {
      expect(normalizeSenegalPhone("+2217712345678")).toBeNull();
    });

    it("rejects 79 prefix (invalid)", () => {
      expect(normalizeSenegalPhone("+221791234567")).toBeNull();
    });
  });

  describe("isValidSenegalPhone", () => {
    it("returns true for valid number", () => {
      expect(isValidSenegalPhone("+221771234567")).toBe(true);
    });

    it("returns false for invalid number", () => {
      expect(isValidSenegalPhone("invalid")).toBe(false);
    });
  });

  describe("SenegalPhoneSchema", () => {
    it("validates and normalizes a valid phone", () => {
      const result = SenegalPhoneSchema.parse("77 123 45 67");
      expect(result).toBe("+221771234567");
    });

    it("rejects an invalid phone", () => {
      expect(() => SenegalPhoneSchema.parse("not-a-phone")).toThrow();
    });
  });
});
