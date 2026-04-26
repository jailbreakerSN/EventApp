import { describe, it, expect } from "vitest";
import { z, type ZodTypeAny } from "zod";
import {
  // Event & registration
  EventSchema,
  CreateEventSchema,
  RegistrationSchema,
  RegistrationStatusSchema,
  // Check-in
  CheckInRequestSchema,
  CheckinRecordSchema,
  BulkCheckinRequestSchema,
  BulkCheckinResponseSchema,
  OfflineSyncDataSchema,
  EncryptedSyncEnvelopeSchema,
  AnomalySchema,
  AnomalyResponseSchema,
  // Organization & subscription
  OrganizationSchema,
  OrganizationPlanSchema,
  SubscriptionSchema,
  PlanUsageSchema,
  // Audit & permissions
  AuditLogEntrySchema,
  // Badge
  GeneratedBadgeSchema,
  UploadUrlResponseSchema,
  // Payment
  PaymentSchema,
  PaymentClientViewSchema,
  PayoutSchema,
  WebhookProviderSchema,
  // User
  UserProfileSchema,
  // API envelope
} from "../index";

// ─── Zod schema contract snapshots ─────────────────────────────────────────
// Serializes the structural shape of every public wire schema into a
// deterministic JSON tree and snapshots it. Breaking changes
// (renamed / removed / retyped fields, widened or narrowed enums, new
// required props) fail the test loud. Additive changes can land by
// running `vitest -u` in the PR that introduces them — the snapshot
// diff then lives in the PR for reviewer signoff.
//
// Why not `zod-to-json-schema`? Adds a dependency we don't otherwise
// need, emits a lot of JSON-Schema noise (`$ref`, `allOf`, `definitions`)
// that would spam every diff. This file walks `._def` and emits a small
// shape that's stable across zod 3.x patch releases.
//
// Covered surface: the 20 Tier-1 schemas identified in the 2026-04-20
// badge-journey review + Sprint C / D contract additions. Internal
// helper schemas (`LocalizedStringSchema`, `AnomalyEvidenceSchema`,
// etc.) are not snapshotted — they're composition bricks, not wire
// contracts.

// ─── Serializer ─────────────────────────────────────────────────────────────

type Shape =
  | { kind: "string"; checks?: string[] }
  | { kind: "number"; checks?: string[] }
  | { kind: "boolean" }
  | { kind: "null" }
  | { kind: "date" }
  | { kind: "literal"; value: unknown }
  | { kind: "enum"; values: string[] }
  | { kind: "nativeEnum" }
  | { kind: "array"; element: Shape }
  | { kind: "tuple"; items: Shape[] }
  | { kind: "record"; key: Shape; value: Shape }
  | { kind: "object"; fields: Record<string, FieldShape> }
  | { kind: "union"; options: Shape[] }
  | { kind: "discriminatedUnion"; discriminator: string; options: Shape[] }
  | { kind: "intersection"; left: Shape; right: Shape }
  | { kind: "optional"; inner: Shape }
  | { kind: "nullable"; inner: Shape }
  | { kind: "default"; inner: Shape; hasDefault: true }
  | { kind: "effects"; inner: Shape }
  | { kind: "lazy" }
  | { kind: "any" }
  | { kind: "unknown" }
  | { kind: "never" };

interface FieldShape {
  required: boolean;
  shape: Shape;
}

function serialize(schema: ZodTypeAny): Shape {
  const def = (schema as unknown as { _def: { typeName: string; [k: string]: unknown } })._def;
  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodString: {
      const checks = (def.checks as Array<{ kind: string }> | undefined) ?? [];
      const names = checks.map((c) => c.kind).sort();
      return names.length ? { kind: "string", checks: names } : { kind: "string" };
    }
    case z.ZodFirstPartyTypeKind.ZodNumber: {
      const checks = (def.checks as Array<{ kind: string }> | undefined) ?? [];
      const names = checks.map((c) => c.kind).sort();
      return names.length ? { kind: "number", checks: names } : { kind: "number" };
    }
    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return { kind: "boolean" };
    case z.ZodFirstPartyTypeKind.ZodNull:
      return { kind: "null" };
    case z.ZodFirstPartyTypeKind.ZodDate:
      return { kind: "date" };
    case z.ZodFirstPartyTypeKind.ZodLiteral:
      return { kind: "literal", value: def.value as unknown };
    case z.ZodFirstPartyTypeKind.ZodEnum:
      return { kind: "enum", values: [...(def.values as string[])].sort() };
    case z.ZodFirstPartyTypeKind.ZodNativeEnum:
      return { kind: "nativeEnum" };
    case z.ZodFirstPartyTypeKind.ZodArray:
      return { kind: "array", element: serialize(def.type as ZodTypeAny) };
    case z.ZodFirstPartyTypeKind.ZodTuple:
      return {
        kind: "tuple",
        items: (def.items as ZodTypeAny[]).map(serialize),
      };
    case z.ZodFirstPartyTypeKind.ZodRecord:
      return {
        kind: "record",
        key: serialize(def.keyType as ZodTypeAny),
        value: serialize(def.valueType as ZodTypeAny),
      };
    case z.ZodFirstPartyTypeKind.ZodObject: {
      const rawShape = (def.shape as () => Record<string, ZodTypeAny>)();
      const fields: Record<string, FieldShape> = {};
      // Sort keys so the snapshot is stable even if the source file
      // reorders fields during a refactor (common with IDE auto-sort).
      for (const key of Object.keys(rawShape).sort()) {
        const child = rawShape[key];
        const inner = serialize(child);
        const required = !isOptional(child);
        fields[key] = { required, shape: inner };
      }
      return { kind: "object", fields };
    }
    case z.ZodFirstPartyTypeKind.ZodUnion:
      return {
        kind: "union",
        options: (def.options as ZodTypeAny[]).map(serialize),
      };
    case z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion:
      return {
        kind: "discriminatedUnion",
        discriminator: def.discriminator as string,
        options: (def.options as ZodTypeAny[]).map(serialize),
      };
    case z.ZodFirstPartyTypeKind.ZodIntersection:
      return {
        kind: "intersection",
        left: serialize(def.left as ZodTypeAny),
        right: serialize(def.right as ZodTypeAny),
      };
    case z.ZodFirstPartyTypeKind.ZodOptional:
      return { kind: "optional", inner: serialize(def.innerType as ZodTypeAny) };
    case z.ZodFirstPartyTypeKind.ZodNullable:
      return { kind: "nullable", inner: serialize(def.innerType as ZodTypeAny) };
    case z.ZodFirstPartyTypeKind.ZodDefault:
      return {
        kind: "default",
        inner: serialize(def.innerType as ZodTypeAny),
        hasDefault: true,
      };
    case z.ZodFirstPartyTypeKind.ZodEffects:
      return { kind: "effects", inner: serialize(def.schema as ZodTypeAny) };
    case z.ZodFirstPartyTypeKind.ZodLazy:
      return { kind: "lazy" };
    case z.ZodFirstPartyTypeKind.ZodAny:
      return { kind: "any" };
    case z.ZodFirstPartyTypeKind.ZodUnknown:
      return { kind: "unknown" };
    case z.ZodFirstPartyTypeKind.ZodNever:
      return { kind: "never" };
    default: {
      // Fall-through: some zod wrappers (`.pipe()`, `.brand()`) nest an
      // inner schema on `._def.schema` or `._def.innerType`. Recurse if
      // we find one; otherwise return `unknown` so the diff surfaces
      // unhandled typeNames instead of silently snapshotting `{}`.
      const inner =
        (def as { schema?: ZodTypeAny; innerType?: ZodTypeAny }).schema ??
        (def as { innerType?: ZodTypeAny }).innerType;
      if (inner) return serialize(inner);
      return { kind: "unknown" } as Shape;
    }
  }
}

function isOptional(schema: ZodTypeAny): boolean {
  const typeName = (schema as unknown as { _def: { typeName: string } })._def.typeName;
  if (typeName === z.ZodFirstPartyTypeKind.ZodOptional) return true;
  if (typeName === z.ZodFirstPartyTypeKind.ZodDefault) return true;
  return false;
}

// ─── Snapshots ──────────────────────────────────────────────────────────────

// One inline snapshot per schema — single-file reviews stay scannable
// and the snapshot lives next to the schema name in the diff.
describe("shared-types contract snapshots", () => {
  const cases: Array<{ name: string; schema: ZodTypeAny }> = [
    // Event & registration
    { name: "EventSchema", schema: EventSchema },
    { name: "CreateEventSchema", schema: CreateEventSchema },
    { name: "RegistrationSchema", schema: RegistrationSchema },
    { name: "RegistrationStatusSchema", schema: RegistrationStatusSchema },
    // Check-in
    { name: "CheckInRequestSchema", schema: CheckInRequestSchema },
    { name: "CheckinRecordSchema", schema: CheckinRecordSchema },
    { name: "BulkCheckinRequestSchema", schema: BulkCheckinRequestSchema },
    { name: "BulkCheckinResponseSchema", schema: BulkCheckinResponseSchema },
    { name: "OfflineSyncDataSchema", schema: OfflineSyncDataSchema },
    { name: "EncryptedSyncEnvelopeSchema", schema: EncryptedSyncEnvelopeSchema },
    { name: "AnomalySchema", schema: AnomalySchema },
    { name: "AnomalyResponseSchema", schema: AnomalyResponseSchema },
    // Organization & subscription
    { name: "OrganizationSchema", schema: OrganizationSchema },
    { name: "OrganizationPlanSchema", schema: OrganizationPlanSchema },
    { name: "SubscriptionSchema", schema: SubscriptionSchema },
    { name: "PlanUsageSchema", schema: PlanUsageSchema },
    // Audit
    { name: "AuditLogEntrySchema", schema: AuditLogEntrySchema },
    // Badge
    { name: "GeneratedBadgeSchema", schema: GeneratedBadgeSchema },
    { name: "UploadUrlResponseSchema", schema: UploadUrlResponseSchema },
    // Payment
    { name: "PaymentSchema", schema: PaymentSchema },
    // P1-09 (audit C3) — public-facing projection. Pinning its shape
    // is the regression guard for the "no providerMetadata, no
    // callbackUrl" invariant on `getPaymentStatus`,
    // `listEventPayments`, and `getEventPaymentSummary`.
    { name: "PaymentClientViewSchema", schema: PaymentClientViewSchema },
    { name: "PayoutSchema", schema: PayoutSchema },
    // Phase 2 — wire-facing source enum: who can POST webhooks at us.
    // Adding a new aggregator (e.g. mtn_money) MUST touch this snapshot
    // so the addition is reviewable in the same diff.
    { name: "WebhookProviderSchema", schema: WebhookProviderSchema },
    // User
    { name: "UserProfileSchema", schema: UserProfileSchema },
  ];

  for (const { name, schema } of cases) {
    it(`${name} shape is stable`, () => {
      const shape = serialize(schema);
      expect(shape).toMatchSnapshot();
    });
  }
});
