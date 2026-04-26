# Architecture Decision Records

ADRs document the significant architectural decisions made during the development of Teranga. Each record is immutable once accepted — if a decision is reversed, a new ADR supersedes it.

**Format:** Based on [MADR](https://adr.github.io/madr/) (Markdown Architectural Decision Records).

---

## Writing a new ADR

Start from the [template](./0000-template.md). Each ADR is immutable once `Accepted` — to revise, write a new ADR that supersedes the old one and update the old ADR's `Status` to `Superseded by [ADR-NNNN](./NNNN-...md)`.

## Index

| # | Title | Status | Date |
|---|---|---|---|
| [0000](./0000-template.md) | Template for new ADRs | n/a | n/a |
| [0001](./0001-cloud-run-vs-functions.md) | API on Cloud Run instead of Cloud Functions | Accepted | 2026-01 |
| [0002](./0002-zod-single-source-of-truth.md) | Zod schemas as single source of truth | Accepted | 2026-01 |
| [0003](./0003-qr-v4-hkdf-design.md) | QR v4: HKDF-based per-event key derivation | Accepted | 2026-03 |
| [0004](./0004-offline-sync-ecdh-encryption.md) | Offline sync: ECDH-X25519 ephemeral encryption | Accepted | 2026-03 |
| [0005](./0005-deny-all-firestore-rules.md) | Deny-all Firestore security rules default | Accepted | 2026-01 |
| [0006](./0006-denormalized-plan-limits.md) | Denormalize plan limits onto org document | Accepted | 2026-02 |
| [0007](./0007-fastify-layered-architecture.md) | Fastify layered architecture (routes/services/repos) | Accepted | 2026-01 |
| [0008](./0008-soft-delete-only.md) | Soft-delete only (no hard deletes anywhere) | Accepted | 2026-04 |
| [0009](./0009-iso-8601-timestamps.md) | Store all timestamps as ISO 8601 strings | Accepted | 2026-04 |
| [0010](./0010-domain-event-bus.md) | Domain event bus for side effects | Accepted | 2026-04 |
| [0011](./0011-rbac-resource-action-permissions.md) | RBAC with granular `resource:action` permissions | Accepted | 2026-04 |
| [0012](./0012-multi-tenancy-via-organization-id.md) | Multi-tenancy via `organizationId` in custom claims | Accepted | 2026-04 |
| [0013](./0013-api-key-format-checksum-hashed.md) | API key format `terk_*` with checksum + SHA-256 hashed storage | Accepted | 2026-04 |
| [0014](./0014-graceful-shutdown-process-error-handling.md) | Graceful shutdown + process-level error handling | Accepted | 2026-04 |
| [0015](./0015-trust-proxy-auth-aware-rate-limit.md) | Trust proxy + auth-aware rate limiting | Accepted | 2026-04 |
| [0016](./0016-runtime-secrets-via-secret-manager.md) | Runtime secrets via GCP Secret Manager | Accepted | 2026-04 |
| [0017](./0017-registration-payment-state-machine.md) | Registration / Payment state machine | Accepted | 2026-04 |
| [0018](./0018-verify-on-return.md) | Verify-on-return as IPN-fallback finalisation path | Accepted | 2026-04 |
