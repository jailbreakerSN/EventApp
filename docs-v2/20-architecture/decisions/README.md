# Architecture Decision Records

ADRs document the significant architectural decisions made during the development of Teranga. Each record is immutable once accepted — if a decision is reversed, a new ADR supersedes it.

**Format:** Based on [MADR](https://adr.github.io/madr/) (Markdown Architectural Decision Records).

---

## Index

| # | Title | Status | Date |
|---|---|---|---|
| [0001](./0001-cloud-run-vs-functions.md) | API on Cloud Run instead of Cloud Functions | Accepted | 2026-01 |
| [0002](./0002-zod-single-source-of-truth.md) | Zod schemas as single source of truth | Accepted | 2026-01 |
| [0003](./0003-qr-v4-hkdf-design.md) | QR v4: HKDF-based per-event key derivation | Accepted | 2026-03 |
| [0004](./0004-offline-sync-ecdh-encryption.md) | Offline sync: ECDH-X25519 ephemeral encryption | Accepted | 2026-03 |
| [0005](./0005-deny-all-firestore-rules.md) | Deny-all Firestore security rules default | Accepted | 2026-01 |
| [0006](./0006-denormalized-plan-limits.md) | Denormalize plan limits onto org document | Accepted | 2026-02 |
| [0007](./0007-fastify-layered-architecture.md) | Fastify layered architecture (routes/services/repos) | Accepted | 2026-01 |
